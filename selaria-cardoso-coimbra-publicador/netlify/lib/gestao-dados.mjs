// Regras de negócio da Gestão de Clientes: criar cliente, gravar seções, tarefas, Ads, link do cliente.
// As functions só chamam estas funções; nada de regra fica espalhado nas rotas.
import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "./ml.mjs";
import {
  CHAVE_INDICE, apagar, chaveAds, chaveRegistros, chaveSecao, chaveToken, gravar, gravarSecao, ler, lerSecao, listar,
} from "./gestao-store.mjs";
import {
  LIMITES, limparContas, limparDatas, limparDiario, limparFull, limparLancamento, limparMetas, limparNotas,
  limparPerfilEditavel, limparPrioridadesAdmin, limparPrioridadesCliente, limparRegistro, limparTarefas, novoRecado, txt,
} from "./gestao-validar.mjs";
import { tarefasDoModelo } from "./gestao-modelo.mjs";
import {
  addMeses, anoDaChave, chaveRegistro, contarTarefas, diaValido, hojeSP, mesDe, mesValido, periodoValido,
  recortar, resumir, statusMeta, valorAtualDaMeta,
} from "../../public/gestao/calc.mjs";

export const SECOES_ADMIN = ["perfil", "tarefas", "metas", "prioridades", "diario", "full", "datas", "notas"];
const PADRAO = { perfil: null, tarefas: [], metas: [], prioridades: [], recados: [], diario: [], full: [], datas: [], notas: { texto: "" } };

const agora = () => new Date().toISOString();
const sha = (t) => createHash("sha256").update(t).digest("hex");
export const idClienteValido = (id) => typeof id === "string" && /^c_[A-Za-z0-9_-]{12}$/.test(id);
export const idContaValido = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id);

export async function mapLimite(itens, limite, fn) {
  const saida = new Array(itens.length);
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const atual = i++;
      saida[atual] = await fn(itens[atual], atual);
    }
  });
  await Promise.all(trabalhadores);
  return saida;
}

// ---------- índice e perfil ----------

async function lerIndice() {
  const r = await lerSecao(CHAVE_INDICE, []);
  return Array.isArray(r.dados) ? r.dados : [];
}

async function salvarIndice(ids) {
  await gravarSecao(CHAVE_INDICE, ids);
}

export async function lerPerfil(id) {
  if (!idClienteValido(id)) throw new HttpError("Cliente não encontrado.", 404);
  const p = await lerSecao(chaveSecao(id, "perfil"), null);
  if (!p.dados) throw new HttpError("Cliente não encontrado.", 404);
  return p;
}

export async function criarCliente(entrada) {
  const id = "c_" + randomBytes(9).toString("base64url");
  const contas = limparContas(entrada?.contas ?? []);
  const perfil = {
    nome: txt(entrada?.nome, 80, { obrigatorio: true, campo: "o nome do cliente" }),
    contato: txt(entrada?.contato, 120),
    observacao: txt(entrada?.observacao, 500, { linhas: true }),
    contas,
    ativo: true,
    criadoEm: agora(),
    token: null,
    tokenCriadoEm: null,
  };
  await gravarSecao(chaveSecao(id, "perfil"), perfil);
  await gravarSecao(chaveSecao(id, "tarefas"), tarefasDoModelo());
  const ids = await lerIndice();
  await salvarIndice([...ids, id]);
  await gerarToken(id);
  return id;
}

export async function excluirCliente(id, confirmarNome) {
  const perfil = await lerPerfil(id);
  if (txt(confirmarNome, 80) !== perfil.dados.nome) throw new HttpError("Digite o nome exato do cliente para confirmar a exclusão.", 400);
  if (perfil.dados.token) await apagar(chaveToken(sha(perfil.dados.token)));
  for (const chave of await listar(`clientes/${id}/`)) await apagar(chave);
  const ids = await lerIndice();
  await salvarIndice(ids.filter((x) => x !== id));
}

// ---------- link do cliente ----------

export async function gerarToken(id) {
  const perfil = await lerPerfil(id);
  if (perfil.dados.token) await apagar(chaveToken(sha(perfil.dados.token)));
  const token = randomBytes(32).toString("base64url"); // 43 caracteres, 256 bits
  await gravar(chaveToken(sha(token)), { clienteId: id });
  await gravarSecao(chaveSecao(id, "perfil"), { ...perfil.dados, token, tokenCriadoEm: agora() });
  return token;
}

export async function revogarToken(id) {
  const perfil = await lerPerfil(id);
  if (perfil.dados.token) await apagar(chaveToken(sha(perfil.dados.token)));
  await gravarSecao(chaveSecao(id, "perfil"), { ...perfil.dados, token: null, tokenCriadoEm: null });
}

// Devolve o id do cliente dono do código, ou null. Confere nos dois sentidos para um mapa antigo nunca liberar acesso.
export async function clienteDoToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const reg = await ler(chaveToken(sha(token)));
  if (!reg || !idClienteValido(reg.clienteId)) return null;
  const perfil = await lerSecao(chaveSecao(reg.clienteId, "perfil"), null);
  if (!perfil.dados || perfil.dados.ativo === false) return null;
  if (perfil.dados.token !== token) return null;
  return reg.clienteId;
}

// ---------- seções ----------

export async function salvarSecao(id, secao, dados, rev, quem = "admin") {
  if (!SECOES_ADMIN.includes(secao)) throw new HttpError("Seção desconhecida.", 404);
  const perfil = await lerPerfil(id);
  const contas = perfil.dados.contas;
  let limpo;
  if (secao === "perfil") {
    limpo = limparPerfilEditavel(dados, perfil.dados);
    const antes = new Set(perfil.dados.contas.map((c) => c.id));
    const depois = new Set(limpo.contas.map((c) => c.id));
    for (const contaId of antes) {
      if (!depois.has(contaId)) for (const chave of await listar(`clientes/${id}/ads/${contaId}/`)) await apagar(chave);
    }
  } else if (secao === "tarefas") limpo = limparTarefas(dados, contas);
  else if (secao === "metas") limpo = limparMetas(dados, contas);
  else if (secao === "diario") limpo = limparDiario(dados, contas);
  else if (secao === "full") limpo = limparFull(dados, contas);
  else if (secao === "datas") limpo = limparDatas(dados);
  else if (secao === "notas") limpo = limparNotas(dados);
  else if (secao === "prioridades") {
    const atuais = await lerSecao(chaveSecao(id, "prioridades"), []);
    limpo = quem === "cliente" ? limparPrioridadesCliente(dados, contas, atuais.dados) : limparPrioridadesAdmin(dados, contas, atuais.dados);
  }
  const novaRev = await gravarSecao(chaveSecao(id, secao), limpo, rev);
  return { rev: novaRev, dados: limpo };
}

// ---------- tarefas: registro de OK / Não OK ----------

export async function registrarTarefa(id, tarefaId, periodo, status, motivo) {
  const tarefas = await lerSecao(chaveSecao(id, "tarefas"), []);
  const tarefa = tarefas.dados.find((t) => t.id === tarefaId);
  if (!tarefa) throw new HttpError("Tarefa não encontrada.", 404);
  if (!periodoValido(tarefa.frequencia, periodo)) throw new HttpError("Período inválido para esta tarefa.", 400);
  const ano = anoDaChave(periodo);
  const chave = chaveRegistros(id, ano);
  const doc = await lerSecao(chave, {});
  const registro = limparRegistro(status, motivo);
  const k = chaveRegistro(tarefaId, periodo);
  if (registro) doc.dados[k] = registro;
  else delete doc.dados[k];
  await gravarSecao(chave, doc.dados);
  return registro;
}

export async function lerRegistros(id, ano) {
  if (!/^\d{4}$/.test(String(ano))) throw new HttpError("Ano inválido.", 400);
  return (await lerSecao(chaveRegistros(id, ano), {})).dados;
}

// ---------- Ads ----------

async function exigirConta(id, contaId) {
  const perfil = await lerPerfil(id);
  const conta = perfil.dados.contas.find((c) => c.id === contaId);
  if (!conta) throw new HttpError("Conta não encontrada neste cliente.", 404);
  return { perfil, conta };
}

export async function lerAds(id, contaId, meses) {
  await exigirConta(id, contaId);
  const saida = {};
  await mapLimite(meses, 4, async (mes) => {
    if (!mesValido(mes)) throw new HttpError("Mês inválido.", 400);
    saida[mes] = (await lerSecao(chaveAds(id, contaId, mes), {})).dados;
  });
  return saida;
}

// dias: { "2026-10-31": {gasto,...} | null }. null apaga o dia.
export async function lancarAds(id, contaId, dias, fonte = "manual") {
  await exigirConta(id, contaId);
  if (!dias || typeof dias !== "object" || Array.isArray(dias)) throw new HttpError("Envie os dias como objeto.", 400);
  const entradas = Object.entries(dias);
  if (entradas.length > 400) throw new HttpError("Máximo de 400 dias por envio.", 400);
  const porMes = new Map();
  for (const [dia, valor] of entradas) {
    if (!diaValido(dia)) throw new HttpError(`Data inválida: ${dia}`, 400);
    const mes = mesDe(dia);
    if (!porMes.has(mes)) porMes.set(mes, {});
    porMes.get(mes)[dia] = valor === null ? null : limparLancamento(valor, fonte);
  }
  let gravados = 0, removidos = 0;
  for (const [mes, mudancas] of porMes) {
    const chave = chaveAds(id, contaId, mes);
    const doc = await lerSecao(chave, {});
    for (const [dia, v] of Object.entries(mudancas)) {
      if (v === null) { if (dia in doc.dados) removidos += 1; delete doc.dados[dia]; }
      else { doc.dados[dia] = v; gravados += 1; }
    }
    await gravarSecao(chave, doc.dados);
  }
  return { gravados, removidos };
}

export async function vincularContaMl(id, contaId, mlUserId) {
  const { perfil } = await exigirConta(id, contaId);
  const contas = perfil.dados.contas.map((c) => (c.id === contaId ? { ...c, mlUserId: String(mlUserId) } : c));
  await gravarSecao(chaveSecao(id, "perfil"), { ...perfil.dados, contas });
}

// ---------- recados ----------

export async function adicionarRecado(id, de, texto) {
  const doc = await lerSecao(chaveSecao(id, "recados"), []);
  const novo = novoRecado(de, texto);
  const lista = [...doc.dados, novo].slice(-LIMITES.recados);
  await gravarSecao(chaveSecao(id, "recados"), lista);
  return novo;
}

// quem lê marca como lidas as mensagens da outra ponta
export async function marcarRecadosLidos(id, quem) {
  const doc = await lerSecao(chaveSecao(id, "recados"), []);
  const alvo = quem === "admin" ? "cliente" : "analista";
  let mudou = false;
  const lista = doc.dados.map((r) => (r.de === alvo && !r.lido ? ((mudou = true), { ...r, lido: true }) : r));
  if (mudou) await gravarSecao(chaveSecao(id, "recados"), lista);
}

// ---------- carga completa (admin) ----------

async function carregarAds(id, contas, meses) {
  const saida = {};
  await mapLimite(contas, 4, async (c) => {
    saida[c.id] = {};
    for (const mes of meses) saida[c.id][mes] = (await lerSecao(chaveAds(id, c.id, mes), {})).dados;
  });
  return saida;
}

export async function carregarCompleto(id, hoje = hojeSP()) {
  const perfil = await lerPerfil(id);
  const revs = { perfil: perfil.rev };
  const doc = { id, perfil: perfil.dados };
  const secoes = ["tarefas", "metas", "prioridades", "recados", "diario", "full", "datas", "notas"];
  await Promise.all(secoes.map(async (s) => {
    const r = await lerSecao(chaveSecao(id, s), PADRAO[s]);
    doc[s] = r.dados;
    revs[s] = r.rev;
  }));
  const ano = Number(hoje.slice(0, 4));
  doc.registros = {};
  for (const a of [String(ano), String(ano - 1)]) Object.assign(doc.registros, await lerRegistros(id, a));
  const meses = [mesDe(hoje), addMeses(mesDe(hoje), -1)];
  doc.ads = await carregarAds(id, perfil.dados.contas, meses);
  doc.revs = revs;
  return doc;
}

// ---------- o que o CLIENTE pode ver ----------
// Esta função é a fronteira de segurança do portal: monta uma resposta nova, campo a campo.
// Nada do documento interno é repassado por inteiro. Notas internas, contato, observação e token nunca entram.

export function projetarParaCliente(doc) {
  const contas = doc.perfil.contas;
  const adsVisiveis = new Set(contas.filter((c) => !c.ocultoAds).map((c) => c.id));
  const tarefas = doc.tarefas
    .filter((t) => t.ativo !== false && !t.oculto)
    .map((t) => ({ id: t.id, titulo: t.titulo, frequencia: t.frequencia, categoria: t.categoria, contaId: t.contaId, ordem: t.ordem }));
  const idsTarefas = new Set(tarefas.map((t) => t.id));
  const registros = {};
  for (const [k, v] of Object.entries(doc.registros || {})) {
    if (idsTarefas.has(k.split("|")[0])) registros[k] = { status: v.status, motivo: v.motivo, em: v.em };
  }
  const ads = {};
  for (const [contaId, meses] of Object.entries(doc.ads || {})) if (adsVisiveis.has(contaId)) ads[contaId] = meses;
  return {
    cliente: { nome: doc.perfil.nome },
    contas: contas.map((c) => ({ id: c.id, marketplace: c.marketplace, nome: c.nome, adsVisivel: adsVisiveis.has(c.id) })),
    tarefas,
    registros,
    // meta ligada a uma conta com Ads oculto não aparece: a barra de progresso revelaria os números
    metas: doc.metas.filter((m) => !m.oculto && (m.contaId == null || adsVisiveis.has(m.contaId))).map((m) => ({
      id: m.id, contaId: m.contaId, metrica: m.metrica, rotulo: m.rotulo, periodo: m.periodo, alvo: m.alvo, sentido: m.sentido,
      atualManual: m.atualManual, observacao: m.observacao,
    })),
    prioridades: doc.prioridades.map((p) => ({
      id: p.id, titulo: p.titulo, detalhe: p.detalhe, contaId: p.contaId, urgencia: p.urgencia, status: p.status, origem: p.origem,
      respostaAnalista: p.respostaAnalista, ordem: p.ordem, criadoEm: p.criadoEm,
    })),
    recados: doc.recados.map((r) => ({ id: r.id, de: r.de, texto: r.texto, em: r.em, lido: r.lido })),
    diario: doc.diario.filter((d) => !d.oculto).slice(-300).map((d) => ({ id: d.id, data: d.data, texto: d.texto, categoria: d.categoria, contaId: d.contaId })),
    full: doc.full.filter((p) => !p.oculto).map((p) => ({ id: p.id, sku: p.sku, produto: p.produto, contaId: p.contaId, status: p.status, estoqueFull: p.estoqueFull, observacao: p.observacao })),
    datas: doc.datas.filter((d) => !d.oculto).map((d) => ({ id: d.id, nome: d.nome, data: d.data, preparacao: d.preparacao, feito: d.feito })),
    ads,
    revPrioridades: doc.revs?.prioridades ?? 0,
  };
}

export async function carregarParaCliente(id, hoje = hojeSP()) {
  const doc = await carregarCompleto(id, hoje);
  // o cliente enxerga um recorte um pouco maior de Ads (3 meses), só das contas visíveis
  const visiveis = doc.perfil.contas.filter((c) => !c.ocultoAds);
  const meses = [mesDe(hoje), addMeses(mesDe(hoje), -1), addMeses(mesDe(hoje), -2)];
  doc.ads = await carregarAds(id, visiveis, meses);
  return projetarParaCliente(doc);
}

// ---------- visão geral (cartões da tela inicial) ----------

export async function resumoCliente(id, hoje = hojeSP()) {
  const perfil = await lerPerfil(id);
  const [tarefas, metas, prioridades, recados] = await Promise.all(
    ["tarefas", "metas", "prioridades", "recados"].map(async (s) => (await lerSecao(chaveSecao(id, s), [])).dados),
  );
  const registros = await lerRegistros(id, hoje.slice(0, 4));
  const mes = mesDe(hoje);
  const contas = [];
  let metasFora = 0;
  for (const c of perfil.dados.contas) {
    // mês atual e anterior, para que uma meta semanal que começa no mês passado também some certo
    const dias = {
      ...(await lerSecao(chaveAds(id, c.id, addMeses(mes, -1)), {})).dados,
      ...(await lerSecao(chaveAds(id, c.id, mes), {})).dados,
    };
    const r = resumir(Object.values(recortar(dias, mes + "-01", hoje)));
    const metaTacos = metas.find((m) => m.metrica === "tacos" && m.contaId === c.id && m.periodo === "mes");
    const estadoTacos = metaTacos && r.tacos != null ? statusMeta(metaTacos, r.tacos).estado : "sem_dado";
    contas.push({
      id: c.id, marketplace: c.marketplace, nome: c.nome, dias: r.dias, tacos: r.tacos, gasto: r.gasto, fatTotal: r.fatTotal,
      metaTacos: metaTacos ? metaTacos.alvo : null, estadoTacos,
    });
    for (const m of metas.filter((x) => x.contaId === c.id)) {
      if (statusMeta(m, valorAtualDaMeta(m, dias, hoje)).estado === "fora") metasFora += 1;
    }
  }
  const tarefasAtivas = tarefas.filter((t) => t.ativo !== false);
  return {
    id,
    nome: perfil.dados.nome,
    ativo: perfil.dados.ativo !== false,
    tokenAtivo: Boolean(perfil.dados.token),
    contas,
    tarefas: {
      diaria: contarTarefas(tarefasAtivas, registros, "diaria", hoje),
      semanal: contarTarefas(tarefasAtivas, registros, "semanal", hoje),
      mensal: contarTarefas(tarefasAtivas, registros, "mensal", hoje),
    },
    metasFora,
    recadosNovos: recados.filter((r) => r.de === "cliente" && !r.lido).length,
    prioridadesNovas: prioridades.filter((p) => p.status === "nova").length,
  };
}

export async function visaoGeral(hoje = hojeSP()) {
  const ids = await lerIndice();
  const resumos = await mapLimite(ids, 4, async (id) => {
    try { return await resumoCliente(id, hoje); } catch { return null; }
  });
  return resumos.filter(Boolean);
}

