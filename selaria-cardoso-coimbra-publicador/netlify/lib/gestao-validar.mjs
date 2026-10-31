// Validação e limpeza de tudo que entra na Gestão.
// Regra: o servidor só guarda campos conhecidos, com tamanho limitado. O resto é descartado.
import { randomUUID } from "node:crypto";
import { HttpError } from "./ml.mjs";
import { FREQUENCIAS, METRICAS, diaValido } from "../../public/gestao/calc.mjs";

export const LIMITES = {
  contas: 20, tarefas: 300, metas: 200, prioridades: 200, diario: 3000, full: 1000, datas: 300, recados: 500,
};

export const MARKETPLACES = ["ml", "shopee", "tiktok"];
export const STATUS_PRIORIDADE = ["nova", "em_andamento", "feita", "adiada"];
export const URGENCIAS = ["alta", "media", "baixa"];
export const STATUS_FULL = ["analisando", "aprovado", "montando", "enviado", "no_full", "descartado"];

export const novoId = () => randomUUID().replace(/-/g, "").slice(0, 16);

// remove caracteres de controle (menos quebra de linha e tab) e corta no tamanho máximo
export function txt(v, max, { obrigatorio = false, campo = "o campo", linhas = false } = {}) {
  let s = v == null ? "" : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (!linhas) s = s.replace(/[\r\n\t]+/g, " ");
  s = s.trim();
  if (s.length > max) s = s.slice(0, max);
  if (obrigatorio && !s) throw new HttpError(`Informe ${campo}.`, 400);
  return s;
}

export function opcao(v, lista, padrao) {
  return lista.includes(v) ? v : padrao;
}

export function numero(v, { min = -1e12, max = 1e12, nulo = true } = {}) {
  if (v === null || v === undefined || v === "") {
    if (nulo) return null;
    throw new HttpError("Informe um número válido.", 400);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError("Número inválido.", 400);
  return Math.min(max, Math.max(min, Math.round(n * 1e6) / 1e6));
}

export function idItem(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : novoId();
}

function listaDe(v, max, nome) {
  if (!Array.isArray(v)) throw new HttpError(`Envie ${nome} como lista.`, 400);
  if (v.length > max) throw new HttpError(`Limite de ${max} itens em ${nome}.`, 400);
  return v;
}

const agora = () => new Date().toISOString();

// ---------- perfil ----------

export function limparContas(lista) {
  const itens = listaDe(lista, LIMITES.contas, "as contas");
  const vistos = new Set();
  return itens.map((c) => {
    const id = idItem(c?.id);
    if (vistos.has(id)) throw new HttpError("Conta repetida.", 400);
    vistos.add(id);
    const mlUserId = txt(c?.mlUserId, 20);
    return {
      id,
      marketplace: opcao(c?.marketplace, MARKETPLACES, "ml"),
      nome: txt(c?.nome, 60, { obrigatorio: true, campo: "o nome da conta" }),
      ...(mlUserId && /^\d+$/.test(mlUserId) ? { mlUserId } : {}),
      ocultoAds: c?.ocultoAds === true,
    };
  });
}

// Campos do perfil que o dono pode editar. Token e datas de sistema não passam por aqui.
export function limparPerfilEditavel(entrada, atual) {
  return {
    ...atual,
    nome: txt(entrada?.nome, 80, { obrigatorio: true, campo: "o nome do cliente" }),
    contato: txt(entrada?.contato, 120),
    observacao: txt(entrada?.observacao, 500, { linhas: true }),
    contas: limparContas(entrada?.contas ?? atual.contas ?? []),
    ativo: entrada?.ativo === false ? false : true,
  };
}

// ---------- seções em lista ----------

const ids = (contas) => new Set((contas || []).map((c) => c.id));
const contaOuNulo = (v, contas) => (typeof v === "string" && ids(contas).has(v) ? v : null);

export function limparTarefas(lista, contas) {
  const itens = listaDe(lista, LIMITES.tarefas, "as tarefas");
  return itens.map((t, i) => ({
    id: idItem(t?.id),
    titulo: txt(t?.titulo, 140, { obrigatorio: true, campo: "o título da tarefa" }),
    frequencia: opcao(t?.frequencia, FREQUENCIAS, "diaria"),
    categoria: txt(t?.categoria, 40),
    contaId: contaOuNulo(t?.contaId, contas),
    ativo: t?.ativo === false ? false : true,
    oculto: t?.oculto === true,
    ordem: Number.isFinite(Number(t?.ordem)) ? Number(t.ordem) : i,
  }));
}

export function limparMetas(lista, contas) {
  const itens = listaDe(lista, LIMITES.metas, "as metas");
  return itens.map((m) => {
    const metrica = opcao(m?.metrica, Object.keys(METRICAS), "custom");
    const alvo = numero(m?.alvo, { min: 0, nulo: false });
    return {
      id: idItem(m?.id),
      contaId: contaOuNulo(m?.contaId, contas),
      metrica,
      rotulo: txt(m?.rotulo, 60) || METRICAS[metrica].rotulo,
      periodo: opcao(m?.periodo, ["dia", "semana", "mes"], "mes"),
      alvo,
      sentido: opcao(m?.sentido, ["min", "max"], METRICAS[metrica].sentido),
      atualManual: metrica === "custom" ? numero(m?.atualManual, { min: 0 }) : null,
      observacao: txt(m?.observacao, 300),
      oculto: m?.oculto === true,
    };
  });
}

export function limparDiario(lista, contas) {
  const itens = listaDe(lista, LIMITES.diario, "o diário");
  return itens.map((d) => {
    if (!diaValido(d?.data)) throw new HttpError("Data inválida no diário.", 400);
    return {
      id: idItem(d?.id),
      data: d.data,
      texto: txt(d?.texto, 500, { obrigatorio: true, campo: "o texto da ação" }),
      categoria: txt(d?.categoria, 40),
      contaId: contaOuNulo(d?.contaId, contas),
      oculto: d?.oculto === true,
    };
  });
}

export function limparFull(lista, contas) {
  const itens = listaDe(lista, LIMITES.full, "os produtos do Full");
  return itens.map((p) => ({
    id: idItem(p?.id),
    sku: txt(p?.sku, 40),
    produto: txt(p?.produto, 120, { obrigatorio: true, campo: "o nome do produto" }),
    contaId: contaOuNulo(p?.contaId, contas),
    status: opcao(p?.status, STATUS_FULL, "analisando"),
    estoqueFull: numero(p?.estoqueFull, { min: 0, max: 1e7 }),
    observacao: txt(p?.observacao, 300),
    oculto: p?.oculto === true,
  }));
}

export function limparDatas(lista) {
  const itens = listaDe(lista, LIMITES.datas, "as datas");
  return itens.map((d) => {
    if (!diaValido(d?.data)) throw new HttpError("Data inválida.", 400);
    return {
      id: idItem(d?.id),
      nome: txt(d?.nome, 60, { obrigatorio: true, campo: "o nome da data" }),
      data: d.data,
      preparacao: txt(d?.preparacao, 500, { linhas: true }),
      feito: d?.feito === true,
      oculto: d?.oculto === true,
    };
  });
}

export function limparNotas(entrada) {
  return { texto: txt(entrada?.texto, 8000, { linhas: true }) };
}

// ---------- prioridades ----------

const prioridadeBase = (p, contas) => ({
  titulo: txt(p?.titulo, 140, { obrigatorio: true, campo: "o título da prioridade" }),
  detalhe: txt(p?.detalhe, 1000, { linhas: true }),
  contaId: contaOuNulo(p?.contaId, contas),
  urgencia: opcao(p?.urgencia, URGENCIAS, "media"),
});

// O dono edita tudo, inclusive status e resposta.
export function limparPrioridadesAdmin(lista, contas, existentes = []) {
  const itens = listaDe(lista, LIMITES.prioridades, "as prioridades");
  const anteriores = new Map(existentes.map((p) => [p.id, p]));
  return itens.map((p, i) => {
    const id = idItem(p?.id);
    const antes = anteriores.get(id);
    return {
      id,
      ...prioridadeBase(p, contas),
      status: opcao(p?.status, STATUS_PRIORIDADE, antes?.status || "nova"),
      origem: antes?.origem || (p?.origem === "cliente" ? "cliente" : "analista"),
      respostaAnalista: txt(p?.respostaAnalista, 500, { linhas: true }),
      criadoEm: antes?.criadoEm || agora(),
      atualizadoEm: agora(),
      ordem: Number.isFinite(Number(p?.ordem)) ? Number(p.ordem) : i,
    };
  });
}

// O cliente edita só título, detalhe, conta, urgência e ordem. Status e resposta do analista são intocáveis.
// Prioridades criadas pelo analista não podem ser apagadas pelo cliente.
export function limparPrioridadesCliente(lista, contas, existentes = []) {
  const itens = listaDe(lista, LIMITES.prioridades, "as prioridades");
  const anteriores = new Map(existentes.map((p) => [p.id, p]));
  const enviados = new Set();
  const saida = [];
  itens.forEach((p, i) => {
    const id = typeof p?.id === "string" && anteriores.has(p.id) ? p.id : novoId();
    if (enviados.has(id)) return;
    enviados.add(id);
    const antes = anteriores.get(id);
    saida.push({
      id,
      ...prioridadeBase(p, contas),
      status: antes?.status || "nova",
      origem: antes?.origem || "cliente",
      respostaAnalista: antes?.respostaAnalista || "",
      criadoEm: antes?.criadoEm || agora(),
      atualizadoEm: antes ? (mudou(antes, p) ? agora() : antes.atualizadoEm) : agora(),
      ordem: Number.isFinite(Number(p?.ordem)) ? Number(p.ordem) : i,
    });
  });
  for (const antes of existentes) {
    if (!enviados.has(antes.id) && antes.origem === "analista") saida.push(antes);
  }
  return saida;
}

function mudou(antes, p) {
  return antes.titulo !== txt(p?.titulo, 140) || antes.detalhe !== txt(p?.detalhe, 1000, { linhas: true }) || antes.urgencia !== p?.urgencia;
}

// ---------- recados ----------

export function novoRecado(de, texto) {
  // "lido" significa: lido pela outra ponta (recado do cliente lido por você; resposta sua lida pelo cliente).
  return { id: novoId(), de, texto: txt(texto, 2000, { obrigatorio: true, campo: "a mensagem", linhas: true }), em: agora(), lido: false };
}

// ---------- registro de tarefa ----------

export function limparRegistro(status, motivo) {
  if (status === null || status === undefined || status === "") return null;
  if (status !== "ok" && status !== "nao_ok") throw new HttpError("Status inválido.", 400);
  return { status, motivo: txt(motivo, 500, { linhas: true }), em: agora() };
}

// ---------- lançamentos de Ads ----------

const CAMPOS_DINHEIRO = ["gasto", "fatTotal", "fatAds"];
const CAMPOS_CONTAGEM = ["pedidos", "pedidosAds", "cliques", "impressoes"];

export function limparLancamento(l, fonte = "manual") {
  const saida = {};
  for (const c of CAMPOS_DINHEIRO) saida[c] = numero(l?.[c], { min: 0, max: 1e9 }) ?? 0;
  for (const c of CAMPOS_CONTAGEM) saida[c] = Math.round(numero(l?.[c], { min: 0, max: 1e9 }) ?? 0);
  if (saida.fatAds > saida.fatTotal) saida.fatTotal = saida.fatAds; // faturamento total nunca pode ser menor que o de ads
  const tacosMl = numero(l?.tacosMl, { min: 0, max: 1000 });
  if (tacosMl != null) saida.tacosMl = tacosMl;
  saida.fonte = ["manual", "ml", "planilha"].includes(l?.fonte) ? l.fonte : fonte;
  saida.em = agora();
  return saida;
}
