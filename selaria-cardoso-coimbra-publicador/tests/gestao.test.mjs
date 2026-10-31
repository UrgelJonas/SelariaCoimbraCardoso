import test from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-32-caracteres-ok";
process.env.GESTAO_SENHA = "senha-forte-123";
process.env.ML_CLIENT_ID = "123";
process.env.ML_CLIENT_SECRET = "abc";

const { usarStoreDeTeste, listar } = await import("../netlify/lib/gestao-store.mjs");
const { selar } = await import("../netlify/lib/sessao.mjs");
const admin = (await import("../netlify/functions/gestao-admin.mjs")).default;
const portal = (await import("../netlify/functions/gestao-cliente.mjs")).default;
const importador = await import("../netlify/functions/gestao-ads-ml.mjs");

const ORIGEM = "https://hub.test";

class MemStore {
  constructor() { this.m = new Map(); }
  async get(k) { const v = this.m.get(k); return v === undefined ? null : JSON.parse(v); }
  async setJSON(k, v) { this.m.set(k, JSON.stringify(v)); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "" } = {}) { return { blobs: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
}

function novoAmbiente() {
  const s = new MemStore();
  usarStoreDeTeste(s);
  return s;
}

async function chamar(handler, caminho, { metodo = "GET", corpo, cookie, headers = {}, seguro = true } = {}) {
  const h = new Headers(headers);
  if (seguro && metodo !== "GET") { h.set("x-gestao", "1"); h.set("origin", ORIGEM); }
  if (cookie) h.set("cookie", cookie);
  if (corpo !== undefined) h.set("content-type", "application/json");
  const r = await handler(new Request(ORIGEM + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo) }));
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* sem corpo */ }
  return { status: r.status, json, texto, headers: r.headers };
}

async function logar() {
  const r = await chamar(admin, "/api/gestao/login", { metodo: "POST", corpo: { senha: process.env.GESTAO_SENHA } });
  assert.equal(r.status, 200);
  const set = r.headers.get("set-cookie");
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);
  assert.match(set, /SameSite=Strict/);
  return set.split(";")[0];
}

const A = (cookie, caminho, extra = {}) => chamar(admin, "/api/gestao" + caminho, { cookie, ...extra });
const C = (token, caminho = "", extra = {}) => chamar(portal, `/api/c/${token}${caminho}`, extra);

async function criar(cookie, nome, contas) {
  const r = await A(cookie, "/clientes", { metodo: "POST", corpo: { nome, contas } });
  assert.equal(r.status, 201);
  const doc = await A(cookie, "/clientes/" + r.json.id);
  assert.equal(doc.status, 200);
  return { id: r.json.id, doc: doc.json, token: doc.json.perfil.token };
}

// ---------------------------------------------------------------- login

test("login: senha errada, sem senha configurada, sem cookie e proteção contra pedidos forjados", async () => {
  novoAmbiente();
  let r = await chamar(admin, "/api/gestao/login", { metodo: "POST", corpo: { senha: "errada" } });
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("set-cookie"), null);

  r = await A(null, "/clientes");
  assert.equal(r.status, 401, "sem cookie não lista clientes");

  const cookie = await logar();
  r = await A(cookie, "/clientes");
  assert.equal(r.status, 200);

  // sem o cabeçalho x-gestao
  r = await chamar(admin, "/api/gestao/clientes", { metodo: "POST", corpo: { nome: "X" }, cookie, seguro: false });
  assert.equal(r.status, 403);
  // origem de outro site
  r = await chamar(admin, "/api/gestao/clientes", { metodo: "POST", corpo: { nome: "X" }, cookie, headers: { "x-gestao": "1", origin: "https://malicioso.test" }, seguro: false });
  assert.equal(r.status, 403);

  // cookie adulterado
  const adulterado = cookie.slice(0, -3) + "AAA";
  r = await A(adulterado, "/clientes");
  assert.equal(r.status, 401);

  const antes = process.env.GESTAO_SENHA;
  process.env.GESTAO_SENHA = "";
  r = await chamar(admin, "/api/gestao/login", { metodo: "POST", corpo: { senha: "" } });
  assert.equal(r.status, 503);
  assert.match(r.json.erro, /GESTAO_SENHA/);
  process.env.GESTAO_SENHA = antes;
});

test("login: bloqueia depois de várias tentativas erradas", async () => {
  novoAmbiente();
  const h = { "x-forwarded-for": "9.9.9.9" };
  for (let i = 0; i < 8; i++) {
    const r = await chamar(admin, "/api/gestao/login", { metodo: "POST", corpo: { senha: "x" + i }, headers: h });
    assert.equal(r.status, 401);
  }
  const r = await chamar(admin, "/api/gestao/login", { metodo: "POST", corpo: { senha: process.env.GESTAO_SENHA }, headers: h });
  assert.equal(r.status, 429, "mesmo com a senha certa, fica bloqueado na janela");
});

// ---------------------------------------------------------------- criação

test("novo cliente: link com 43 caracteres e modelo de tarefas diárias, semanais e mensais", async () => {
  novoAmbiente();
  const cookie = await logar();
  const { doc, token } = await criar(cookie, "Selaria Teste", [
    { marketplace: "ml", nome: "ML Principal" }, { marketplace: "shopee", nome: "Shopee Loja" },
  ]);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const freq = (f) => doc.tarefas.filter((t) => t.frequencia === f).length;
  assert.ok(freq("diaria") >= 2 && freq("semanal") >= 5 && freq("mensal") >= 3);
  assert.ok(doc.tarefas.some((t) => /imagens/i.test(t.titulo)));
  assert.ok(doc.tarefas.some((t) => /cupons/i.test(t.titulo)));
  assert.ok(doc.tarefas.some((t) => /Full/.test(t.titulo)));
  assert.equal(doc.perfil.contas.length, 2);

  const r = await A(cookie, "/clientes", { metodo: "POST", corpo: { nome: "   " } });
  assert.equal(r.status, 400);
});

// ---------------------------------------------------------------- isolamento

test("ISOLAMENTO: o código de um cliente nunca devolve dados de outro", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente Alfa", [{ marketplace: "ml", nome: "Conta Alfa" }]);
  const b = await criar(cookie, "Cliente Beta", [{ marketplace: "ml", nome: "Conta Beta" }]);

  await A(cookie, `/clientes/${a.id}/diario`, { metodo: "PUT", corpo: { rev: 0, dados: [{ data: "2026-10-30", texto: "SEGREDO-ALFA otimizei imagens" }] } });
  await A(cookie, `/clientes/${b.id}/diario`, { metodo: "PUT", corpo: { rev: 0, dados: [{ data: "2026-10-30", texto: "SEGREDO-BETA subi cupom" }] } });
  await A(cookie, `/clientes/${a.id}/ads`, { metodo: "POST", corpo: { contaId: a.doc.perfil.contas[0].id, dias: { "2026-10-30": { gasto: 111, fatTotal: 2000 } } } });
  await A(cookie, `/clientes/${b.id}/ads`, { metodo: "POST", corpo: { contaId: b.doc.perfil.contas[0].id, dias: { "2026-10-30": { gasto: 999.37, fatTotal: 3000 } } } });

  const ra = await C(a.token, "?hoje=2026-10-31");
  const rb = await C(b.token, "?hoje=2026-10-31");
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  assert.equal(ra.json.cliente.nome, "Cliente Alfa");
  assert.equal(rb.json.cliente.nome, "Cliente Beta");
  assert.match(ra.texto, /SEGREDO-ALFA/);
  assert.doesNotMatch(ra.texto, /SEGREDO-BETA|Cliente Beta|Conta Beta|999\.37/);
  assert.match(rb.texto, /SEGREDO-BETA/);
  assert.doesNotMatch(rb.texto, /SEGREDO-ALFA|Cliente Alfa|Conta Alfa|"gasto":111/);

  // usar o código de A para mexer na conta de B não existe: não há id de cliente na rota do portal
  const tentativa = await C(a.token, "/prioridades", { metodo: "PUT", corpo: { dados: [{ titulo: "invasão" }] } });
  assert.equal(tentativa.status, 200);
  const prioB = await A(cookie, `/clientes/${b.id}`);
  assert.equal(prioB.json.prioridades.length, 0, "a escrita do cliente A não vazou para B");
  const prioA = await A(cookie, `/clientes/${a.id}`);
  assert.equal(prioA.json.prioridades.length, 1);
});

test("código inválido, inexistente ou de formato errado dá 404 genérico", async () => {
  novoAmbiente();
  const cookie = await logar();
  await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  for (const t of ["abc", "x".repeat(43), "../../clientes", "a".repeat(200), "%00", "c_naoexiste"]) {
    const r = await C(t);
    assert.equal(r.status, 404, t);
    assert.deepEqual(Object.keys(r.json), ["erro"]);
  }
  assert.equal(r404(await C("")).status, 404);
  function r404(x) { return x; }
});

test("trocar ou revogar o link derruba o link antigo na hora", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  assert.equal((await C(a.token)).status, 200);

  const novo = await A(cookie, `/clientes/${a.id}/token`, { metodo: "POST", corpo: { acao: "gerar" } });
  assert.notEqual(novo.json.token, a.token);
  assert.equal((await C(a.token)).status, 404, "o link antigo morreu");
  assert.equal((await C(novo.json.token)).status, 200);

  await A(cookie, `/clientes/${a.id}/token`, { metodo: "POST", corpo: { acao: "revogar" } });
  assert.equal((await C(novo.json.token)).status, 404);
});

test("cliente arquivado perde o acesso; reativar devolve", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  const perfil = { ...a.doc.perfil, ativo: false };
  await A(cookie, `/clientes/${a.id}/perfil`, { metodo: "PUT", corpo: { rev: a.doc.revs.perfil, dados: perfil } });
  assert.equal((await C(a.token)).status, 404);
  const doc = await A(cookie, `/clientes/${a.id}`);
  await A(cookie, `/clientes/${a.id}/perfil`, { metodo: "PUT", corpo: { rev: doc.json.revs.perfil, dados: { ...doc.json.perfil, ativo: true } } });
  assert.equal((await C(a.token)).status, 200);
});

// ---------------------------------------------------------------- o que o cliente enxerga

test("o cliente NUNCA recebe notas internas, contato, observação ou o próprio código", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  await A(cookie, `/clientes/${a.id}/notas`, { metodo: "PUT", corpo: { rev: 0, dados: { texto: "NOTA-INTERNA-PRIVADA" } } });
  const doc = await A(cookie, `/clientes/${a.id}`);
  await A(cookie, `/clientes/${a.id}/perfil`, {
    metodo: "PUT", corpo: { rev: doc.json.revs.perfil, dados: { ...doc.json.perfil, contato: "CONTATO-PRIVADO 3199999", observacao: "OBS-PRIVADA" } },
  });
  const r = await C(a.token);
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.texto, /NOTA-INTERNA-PRIVADA|CONTATO-PRIVADO|OBS-PRIVADA/);
  assert.ok(!r.texto.includes(a.token), "o código não volta no corpo");
  assert.ok(!("notas" in r.json) && !("perfil" in r.json));
  assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.match(r.headers.get("cache-control"), /no-store/);
});

test("itens ocultos não chegam ao cliente (tarefa, meta, diário, Full, datas) e Ads oculto some com suas metas", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta Visível" }, { marketplace: "shopee", nome: "Conta Oculta" }]);
  const [cv, co] = a.doc.perfil.contas;

  // tarefas: esconde uma
  const tarefas = a.doc.tarefas.map((t, i) => (i === 0 ? { ...t, titulo: "TAREFA-OCULTA", oculto: true } : t));
  await A(cookie, `/clientes/${a.id}/tarefas`, { metodo: "PUT", corpo: { rev: a.doc.revs.tarefas, dados: tarefas } });
  const metas = [
    { metrica: "tacos", contaId: cv.id, alvo: 4, rotulo: "META-VISIVEL" },
    { metrica: "tacos", contaId: cv.id, alvo: 3, rotulo: "META-OCULTA", oculto: true },
    { metrica: "tacos", contaId: co.id, alvo: 5, rotulo: "META-CONTA-OCULTA" },
  ];
  await A(cookie, `/clientes/${a.id}/metas`, { metodo: "PUT", corpo: { rev: 0, dados: metas } });
  await A(cookie, `/clientes/${a.id}/diario`, { metodo: "PUT", corpo: { rev: 0, dados: [{ data: "2026-10-30", texto: "DIARIO-OCULTO", oculto: true }, { data: "2026-10-30", texto: "DIARIO-VISIVEL" }] } });
  await A(cookie, `/clientes/${a.id}/full`, { metodo: "PUT", corpo: { rev: 0, dados: [{ produto: "FULL-OCULTO", oculto: true }, { produto: "FULL-VISIVEL" }] } });
  await A(cookie, `/clientes/${a.id}/datas`, { metodo: "PUT", corpo: { rev: 0, dados: [{ nome: "DATA-OCULTA", data: "2026-11-27", oculto: true }, { nome: "DATA-VISIVEL", data: "2026-12-25" }] } });
  await A(cookie, `/clientes/${a.id}/ads`, { metodo: "POST", corpo: { contaId: cv.id, dias: { "2026-10-30": { gasto: 10, fatTotal: 500 } } } });
  await A(cookie, `/clientes/${a.id}/ads`, { metodo: "POST", corpo: { contaId: co.id, dias: { "2026-10-30": { gasto: 7771.37, fatTotal: 88880.91 } } } });
  const doc = await A(cookie, `/clientes/${a.id}`);
  await A(cookie, `/clientes/${a.id}/perfil`, {
    metodo: "PUT", corpo: { rev: doc.json.revs.perfil, dados: { ...doc.json.perfil, contas: doc.json.perfil.contas.map((c) => (c.id === co.id ? { ...c, ocultoAds: true } : c)) } },
  });

  const r = await C(a.token, "?hoje=2026-10-31");
  assert.equal(r.status, 200);
  for (const proibido of ["TAREFA-OCULTA", "META-OCULTA", "META-CONTA-OCULTA", "DIARIO-OCULTO", "FULL-OCULTO", "DATA-OCULTA", "88880.91", "7771.37"]) {
    assert.ok(!r.texto.includes(proibido), proibido + " vazou para o cliente");
  }
  for (const esperado of ["META-VISIVEL", "DIARIO-VISIVEL", "FULL-VISIVEL", "DATA-VISIVEL"]) {
    assert.ok(r.texto.includes(esperado), esperado + " deveria aparecer");
  }
  assert.ok(r.json.ads[cv.id], "Ads da conta visível aparecem");
  assert.ok(!(co.id in r.json.ads), "Ads da conta oculta não aparecem");
  assert.equal(r.json.contas.find((c) => c.id === co.id).adsVisivel, false);
  assert.ok(!r.json.tarefas.some((t) => t.titulo === "TAREFA-OCULTA"));
  // registros de tarefa oculta também não vazam
  assert.ok(Object.keys(r.json.registros).every((k) => k.split("|")[0] !== tarefas[0].id));
});

// ---------------------------------------------------------------- o que o cliente pode escrever

test("cliente edita prioridades, mas não status, resposta do analista nem itens do analista", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  const contaId = a.doc.perfil.contas[0].id;

  // analista cria uma prioridade e responde
  await A(cookie, `/clientes/${a.id}/prioridades`, {
    metodo: "PUT", corpo: { rev: 0, dados: [{ titulo: "Subir ticket médio", status: "em_andamento", respostaAnalista: "Já comecei os kits", urgencia: "alta" }] },
  });
  let r = await C(a.token);
  const doAnalista = r.json.prioridades[0];
  assert.equal(doAnalista.origem, "analista");

  // cliente tenta: mudar status para "feita", trocar a resposta do analista, e apagar a prioridade do analista
  r = await C(a.token, "/prioridades", {
    metodo: "PUT",
    corpo: { rev: r.json.revPrioridades, dados: [
      { id: doAnalista.id, titulo: doAnalista.titulo, status: "feita", respostaAnalista: "FORJADO", origem: "cliente" },
      { titulo: "Quero foco em perneiras", detalhe: "Black Friday", contaId, status: "feita", origem: "analista", respostaAnalista: "FORJADO" },
    ] },
  });
  assert.equal(r.status, 200);
  const novas = r.json.prioridades;
  const a1 = novas.find((p) => p.id === doAnalista.id);
  assert.equal(a1.status, "em_andamento", "cliente não muda o status");
  assert.equal(a1.respostaAnalista, "Já comecei os kits", "cliente não troca a resposta do analista");
  assert.equal(a1.origem, "analista");
  const a2 = novas.find((p) => p.titulo === "Quero foco em perneiras");
  assert.equal(a2.status, "nova", "item novo do cliente nasce como 'nova'");
  assert.equal(a2.origem, "cliente");
  assert.equal(a2.respostaAnalista, "");
  assert.equal(a2.contaId, contaId);

  // tenta apagar tudo: o do analista permanece, o do cliente some
  const rev = r.json.rev;
  r = await C(a.token, "/prioridades", { metodo: "PUT", corpo: { rev, dados: [] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.prioridades.map((p) => p.titulo), ["Subir ticket médio"]);
});

test("cliente não consegue escrever em tarefas, metas, Ads, notas ou perfil, nem usar a API do dono", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  for (const caminho of ["/tarefas", "/metas", "/ads", "/notas", "/perfil", "/registro", "/token"]) {
    for (const metodo of ["PUT", "POST", "DELETE"]) {
      const r = await C(a.token, caminho, { metodo, corpo: { dados: [], rev: 0 } });
      assert.equal(r.status, 404, `${metodo} ${caminho}`);
    }
  }
  // o código do cliente não vale como login do dono
  const r = await chamar(admin, "/api/gestao/clientes", { cookie: "gestao_sessao=" + a.token });
  assert.equal(r.status, 401);
  const r2 = await chamar(admin, `/api/gestao/clientes/${a.id}`, { cookie: "gestao_sessao=" + a.token });
  assert.equal(r2.status, 401);
});

test("escrita do portal exige cabeçalho e origem do próprio site", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  let r = await C(a.token, "/recados", { metodo: "POST", corpo: { texto: "oi" }, seguro: false });
  assert.equal(r.status, 403);
  r = await C(a.token, "/recados", { metodo: "POST", corpo: { texto: "oi" }, headers: { "x-gestao": "1", origin: "https://outro.test" }, seguro: false });
  assert.equal(r.status, 403);
  r = await C(a.token, "/recados", { metodo: "POST", corpo: { texto: "oi" } });
  assert.equal(r.status, 201);
});

test("recados: cliente envia, dono responde e marca como lido; texto vazio e gigante", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  assert.equal((await C(a.token, "/recados", { metodo: "POST", corpo: { texto: "   " } })).status, 400);
  const grande = await C(a.token, "/recados", { metodo: "POST", corpo: { texto: "a".repeat(5000) } });
  assert.equal(grande.json.recado.texto.length, 2000);

  let resumo = (await A(cookie, "/clientes?hoje=2026-10-31")).json.clientes.find((c) => c.id === a.id);
  assert.equal(resumo.recadosNovos, 1);

  await A(cookie, `/clientes/${a.id}/recados`, { metodo: "POST", corpo: { acao: "lidos" } });
  await A(cookie, `/clientes/${a.id}/recados`, { metodo: "POST", corpo: { texto: "Já vi, obrigado" } });
  resumo = (await A(cookie, "/clientes?hoje=2026-10-31")).json.clientes.find((c) => c.id === a.id);
  assert.equal(resumo.recadosNovos, 0);

  const vistoPeloCliente = await C(a.token);
  assert.deepEqual(vistoPeloCliente.json.recados.map((r) => r.de), ["cliente", "analista"]);
});

// ---------------------------------------------------------------- tarefas

test("tarefas: marcar OK, Não OK com motivo, trocar, limpar; período inválido é recusado", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  const diaria = a.doc.tarefas.find((t) => t.frequencia === "diaria");
  const semanal = a.doc.tarefas.find((t) => t.frequencia === "semanal");
  const reg = (tarefaId, periodo, status, motivo) => A(cookie, `/clientes/${a.id}/registro`, { metodo: "POST", corpo: { tarefaId, periodo, status, motivo } });

  let r = await reg(diaria.id, "D:2026-10-31", "ok");
  assert.equal(r.status, 200);
  r = await reg(diaria.id, "D:2026-10-30", "nao_ok", "Fiquei sem internet");
  assert.equal(r.json.registro.motivo, "Fiquei sem internet");
  r = await reg(semanal.id, "W:2026-W44", "ok");
  assert.equal(r.status, 200);

  let doc = (await A(cookie, `/clientes/${a.id}?hoje=2026-10-31`)).json;
  assert.equal(doc.registros[`${diaria.id}|D:2026-10-31`].status, "ok");
  assert.equal(doc.registros[`${diaria.id}|D:2026-10-30`].motivo, "Fiquei sem internet");
  // o dia seguinte começa zerado
  assert.equal(doc.registros[`${diaria.id}|D:2026-11-01`], undefined);

  assert.equal((await reg(diaria.id, "W:2026-W44", "ok")).status, 400, "diária não aceita chave de semana");
  assert.equal((await reg(semanal.id, "D:2026-10-31", "ok")).status, 400, "semanal não aceita chave de dia");
  assert.equal((await reg(diaria.id, "D:2026-02-30", "ok")).status, 400);
  assert.equal((await reg(diaria.id, "D:2026-10-31", "talvez")).status, 400);
  assert.equal((await reg("inexistente", "D:2026-10-31", "ok")).status, 404);

  await reg(diaria.id, "D:2026-10-31", null);
  doc = (await A(cookie, `/clientes/${a.id}?hoje=2026-10-31`)).json;
  assert.equal(doc.registros[`${diaria.id}|D:2026-10-31`], undefined);

  // visão geral conta o período certo
  const g = (await A(cookie, "/clientes?hoje=2026-10-30")).json.clientes[0];
  assert.equal(g.tarefas.diaria.naoOk, 1);
  const g2 = (await A(cookie, "/clientes?hoje=2026-10-31")).json.clientes[0];
  assert.equal(g2.tarefas.diaria.ok, 0);
});

// ---------------------------------------------------------------- versão (rev)

test("gravar com versão velha é recusado em vez de apagar o que mudou em outra tela", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  const contaId = a.doc.perfil.contas[0].id;
  let r = await A(cookie, `/clientes/${a.id}/metas`, { metodo: "PUT", corpo: { rev: 0, dados: [{ metrica: "tacos", alvo: 4, contaId }] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.rev, 1);
  r = await A(cookie, `/clientes/${a.id}/metas`, { metodo: "PUT", corpo: { rev: 0, dados: [] } });
  assert.equal(r.status, 409);
  const doc = await A(cookie, `/clientes/${a.id}`);
  assert.equal(doc.json.metas.length, 1, "a meta continua lá");
});

// ---------------------------------------------------------------- validação

test("validação: campos desconhecidos são descartados, textos cortados, referências inválidas viram nulas", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "Conta" }]);
  const r = await A(cookie, `/clientes/${a.id}/metas`, {
    metodo: "PUT",
    corpo: { rev: 0, dados: [{ metrica: "inventada", alvo: "12,5x", contaId: "conta-de-outro-cliente", hack: "<script>", rotulo: "x".repeat(500) }] },
  });
  assert.equal(r.status, 400, "alvo não numérico é recusado");
  const ok = await A(cookie, `/clientes/${a.id}/metas`, {
    metodo: "PUT",
    corpo: { rev: 0, dados: [{ metrica: "inventada", alvo: 12.5, contaId: "conta-de-outro-cliente", hack: "<script>", rotulo: "x".repeat(500) }] },
  });
  assert.equal(ok.status, 200);
  const m = ok.json.dados[0];
  assert.equal(m.metrica, "custom");
  assert.equal(m.contaId, null);
  assert.equal(m.rotulo.length, 60);
  assert.ok(!("hack" in m));

  assert.equal((await A(cookie, `/clientes/${a.id}/diario`, { metodo: "PUT", corpo: { rev: 0, dados: [{ data: "31/10/2026", texto: "x" }] } })).status, 400);
  assert.equal((await A(cookie, `/clientes/${a.id}/tarefas`, { metodo: "PUT", corpo: { rev: a.doc.revs.tarefas, dados: [{ titulo: "" }] } })).status, 400);
  assert.equal((await A(cookie, `/clientes/${a.id}/secao-falsa`, { metodo: "PUT", corpo: { rev: 0, dados: [] } })).status, 404);
  assert.equal((await A(cookie, `/clientes/c_inexistente1`)).status, 404);
  assert.equal((await A(cookie, `/clientes/..%2F..%2Ftokens`)).status, 404);
});

// ---------------------------------------------------------------- Ads

test("Ads: lançar, ler por mês, corrigir inconsistência, apagar dia, recusar data e conta inválidas", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "ML" }, { marketplace: "shopee", nome: "Shopee" }]);
  const [ml, sh] = a.doc.perfil.contas;
  const lancar = (contaId, dias) => A(cookie, `/clientes/${a.id}/ads`, { metodo: "POST", corpo: { contaId, dias } });

  let r = await lancar(ml.id, {
    "2026-10-31": { gasto: 45.5, fatTotal: 1200, fatAds: 300, pedidos: 12, pedidosAds: 3, cliques: 150, impressoes: 9000 },
    "2026-11-01": { gasto: 10, fatTotal: 100, fatAds: 500 }, // fatAds > fatTotal: corrige o total
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.gravados, 2);

  await lancar(sh.id, { "2026-10-31": { gasto: 5, fatTotal: 50 } });

  r = await A(cookie, `/clientes/${a.id}/ads?conta=${ml.id}&meses=2026-10,2026-11`);
  assert.equal(r.json.ads["2026-10"]["2026-10-31"].gasto, 45.5);
  assert.equal(r.json.ads["2026-11"]["2026-11-01"].fatTotal, 500);
  assert.equal(r.json.ads["2026-10"]["2026-10-31"].fonte, "manual");
  // as contas não se misturam
  r = await A(cookie, `/clientes/${a.id}/ads?conta=${sh.id}&meses=2026-10`);
  assert.deepEqual(Object.keys(r.json.ads["2026-10"]), ["2026-10-31"]);
  assert.equal(r.json.ads["2026-10"]["2026-10-31"].gasto, 5);

  r = await lancar(ml.id, { "2026-10-31": null });
  assert.equal(r.json.removidos, 1);
  r = await A(cookie, `/clientes/${a.id}/ads?conta=${ml.id}&meses=2026-10`);
  assert.deepEqual(r.json.ads["2026-10"], {});

  assert.equal((await lancar(ml.id, { "2026-02-30": { gasto: 1 } })).status, 400);
  assert.equal((await lancar("conta-que-nao-existe", { "2026-10-31": { gasto: 1 } })).status, 404);
  assert.equal((await lancar(ml.id, { "2026-10-31": { gasto: "abc" } })).status, 400);
  assert.equal((await A(cookie, `/clientes/${a.id}/ads?conta=${ml.id}&meses=2026-13`)).status, 400);
});

test("Ads de um cliente não são acessíveis pela conta de outro cliente", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "A", [{ marketplace: "ml", nome: "ML A" }]);
  const b = await criar(cookie, "B", [{ marketplace: "ml", nome: "ML B" }]);
  await A(cookie, `/clientes/${a.id}/ads`, { metodo: "POST", corpo: { contaId: a.doc.perfil.contas[0].id, dias: { "2026-10-31": { gasto: 1, fatTotal: 2 } } } });
  // pedir ao cliente B os Ads da conta do cliente A
  const r = await A(cookie, `/clientes/${b.id}/ads?conta=${a.doc.perfil.contas[0].id}&meses=2026-10`);
  assert.equal(r.status, 404);
});

// ---------------------------------------------------------------- exclusão

test("excluir cliente exige o nome exato e apaga tudo, inclusive o link", async () => {
  const store = novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente Apagável", [{ marketplace: "ml", nome: "Conta" }]);
  await A(cookie, `/clientes/${a.id}/ads`, { metodo: "POST", corpo: { contaId: a.doc.perfil.contas[0].id, dias: { "2026-10-31": { gasto: 1, fatTotal: 2 } } } });
  assert.ok((await listar(`clientes/${a.id}/`)).length >= 3, "perfil, tarefas e o mês de Ads");

  let r = await A(cookie, `/clientes/${a.id}`, { metodo: "DELETE", corpo: { confirmarNome: "outro nome" } });
  assert.equal(r.status, 400);
  assert.equal((await C(a.token)).status, 200);

  r = await A(cookie, `/clientes/${a.id}`, { metodo: "DELETE", corpo: { confirmarNome: "Cliente Apagável" } });
  assert.equal(r.status, 200);
  assert.equal((await C(a.token)).status, 404);
  assert.deepEqual(await listar(`clientes/${a.id}/`), []);
  assert.deepEqual([...store.m.keys()].filter((k) => k.startsWith("tokens/")), []);
  assert.equal((await A(cookie, "/clientes")).json.clientes.length, 0);
});

test("remover uma conta do cliente apaga os Ads dela", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "ML" }, { marketplace: "shopee", nome: "Shopee" }]);
  const [ml, sh] = a.doc.perfil.contas;
  await A(cookie, `/clientes/${a.id}/ads`, { metodo: "POST", corpo: { contaId: sh.id, dias: { "2026-10-31": { gasto: 1, fatTotal: 2 } } } });
  assert.equal((await listar(`clientes/${a.id}/ads/${sh.id}/`)).length, 1);
  await A(cookie, `/clientes/${a.id}/perfil`, { metodo: "PUT", corpo: { rev: a.doc.revs.perfil, dados: { ...a.doc.perfil, contas: [ml] } } });
  assert.equal((await listar(`clientes/${a.id}/ads/${sh.id}/`)).length, 0);
});

// ---------------------------------------------------------------- visão geral

test("visão geral: TACOS do mês por conta contra a meta, metas fora do alvo", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "ML" }]);
  const ml = a.doc.perfil.contas[0];
  await A(cookie, `/clientes/${a.id}/metas`, { metodo: "PUT", corpo: { rev: 0, dados: [{ metrica: "tacos", contaId: ml.id, alvo: 4, periodo: "mes" }] } });
  await A(cookie, `/clientes/${a.id}/ads`, { metodo: "POST", corpo: { contaId: ml.id, dias: { "2026-10-30": { gasto: 70, fatTotal: 1000 }, "2026-10-31": { gasto: 30, fatTotal: 1000 } } } });
  const g = (await A(cookie, "/clientes?hoje=2026-10-31")).json.clientes[0];
  assert.equal(g.contas[0].tacos, 5);
  assert.equal(g.contas[0].estadoTacos, "fora");
  assert.equal(g.contas[0].metaTacos, 4);
  assert.equal(g.metasFora, 1);
});

// ---------------------------------------------------------------- importação do Mercado Livre

test("importação: converte o resumo do ML em lançamento (faturamento total = ads + orgânico)", () => {
  const l = importador.lancamentoDoResumo({
    cost: 40, total_amount: 400, organic_units_amount: 600, direct_units_quantity: 5, indirect_units_quantity: 3,
    organic_units_quantity: 12, clicks: 200, prints: 10000, tacos: 0.04,
  });
  assert.deepEqual(l, { gasto: 40, fatAds: 400, fatTotal: 1000, pedidosAds: 8, pedidos: 20, cliques: 200, impressoes: 10000, tacosMl: 4, fonte: "ml" });
  // sem resumo pronto, soma as campanhas e ignora razões
  const s = importador.resumoDaResposta({ results: [{ metrics: { cost: 1, clicks: 2, tacos: 5 } }, { metrics: { cost: 3, clicks: 4, tacos: 9 } }] });
  assert.deepEqual(s, { cost: 4, clicks: 6 });
});

function cookieMl(userId = 555) {
  const v = selar({ access_token: "tok", refresh_token: "ref", user_id: userId, expires_at: Date.now() + 5 * 3600 * 1000 });
  return "ml_sessao=" + v;
}

function simularMl({ userId = 555, nickname = "LOJA_TESTE", porDia = {} } = {}) {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    chamadas.push(u);
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
    if (u.endsWith("/users/me")) return json({ id: userId, nickname });
    if (u.includes("/advertising/advertisers?product_id=PADS")) return json({ advertisers: [{ advertiser_id: 9001, site_id: "MLB" }] });
    if (u.includes("/product_ads/campaigns/search")) {
      const dia = new URL(u).searchParams.get("date_from");
      return json({ results: [], metrics_summary: porDia[dia] || { cost: 0, total_amount: 0, clicks: 0, prints: 0 } });
    }
    return json({}, 404);
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

test("importação ML: pede vínculo, importa os dias, recusa conta errada e datas futuras", async () => {
  novoAmbiente();
  const cookie = await logar();
  const a = await criar(cookie, "Cliente", [{ marketplace: "ml", nome: "ML" }, { marketplace: "shopee", nome: "Shopee" }]);
  const [ml, sh] = a.doc.perfil.contas;
  const importar = (corpo, ck = cookieMl()) => chamar(importador.default, "/api/gestao-ads-ml", { metodo: "POST", corpo: { clienteId: a.id, contaId: ml.id, hoje: "2026-10-31", ...corpo }, cookie: cookie + "; " + ck });

  const sim = simularMl({ porDia: {
    "2026-10-29": { cost: 10, total_amount: 200, organic_units_amount: 800, clicks: 50, prints: 1000, direct_units_quantity: 2 },
    "2026-10-30": { cost: 20, total_amount: 300, organic_units_amount: 700, clicks: 80, prints: 2000, direct_units_quantity: 3 },
  } });
  try {
    // 1) sem vínculo: pergunta antes de gravar qualquer coisa
    let r = await importar({ de: "2026-10-29", ate: "2026-10-31" });
    assert.equal(r.status, 409);
    assert.equal(r.json.precisaVincular, true);
    assert.equal(r.json.nickname, "LOJA_TESTE");
    let ads = (await A(cookie, `/clientes/${a.id}/ads?conta=${ml.id}&meses=2026-10`)).json.ads["2026-10"];
    assert.deepEqual(ads, {}, "nada foi gravado antes do vínculo");

    // 2) confirma o vínculo e importa 3 dias
    r = await importar({ de: "2026-10-29", ate: "2026-10-31", vincular: true });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.importados, 3);
    ads = (await A(cookie, `/clientes/${a.id}/ads?conta=${ml.id}&meses=2026-10`)).json.ads["2026-10"];
    assert.equal(ads["2026-10-29"].gasto, 10);
    assert.equal(ads["2026-10-29"].fatTotal, 1000);
    assert.equal(ads["2026-10-30"].fatAds, 300);
    assert.equal(ads["2026-10-31"].gasto, 0, "dia sem movimento vira zero");
    assert.equal(ads["2026-10-30"].fonte, "ml");

    // o vínculo ficou gravado
    const doc = (await A(cookie, `/clientes/${a.id}`)).json;
    assert.equal(doc.perfil.contas[0].mlUserId, "555");

    // 3) outra conta do ML conectada: recusa e não grava
    sim.restaurar();
    const semDados = simularMl({ userId: 777, nickname: "OUTRA_LOJA" });
    r = await importar({ de: "2026-10-29", ate: "2026-10-30" });
    assert.equal(r.status, 409);
    assert.match(r.json.erro, /OUTRA_LOJA/);
    assert.equal(semDados.chamadas.filter((u) => u.includes("campaigns/search")).length, 0, "nem chegou a pedir dados de Ads");
    semDados.restaurar();

    // 4) validações
    const novo = simularMl();
    r = await importar({ de: "2026-10-29", ate: "2026-11-05" });
    assert.equal(r.status, 400, "dia futuro");
    r = await importar({ de: "2026-10-30", ate: "2026-10-01" });
    assert.equal(r.status, 400, "intervalo invertido");
    r = await importar({ de: "2026-07-01", ate: "2026-10-30" });
    assert.equal(r.status, 400, "mais de 62 dias");
    r = await chamar(importador.default, "/api/gestao-ads-ml", { metodo: "POST", corpo: { clienteId: a.id, contaId: sh.id, de: "2026-10-29", ate: "2026-10-30", hoje: "2026-10-31" }, cookie: cookie + "; " + cookieMl() });
    assert.equal(r.status, 400, "Shopee não tem importação automática");
    // sem conta do ML conectada
    r = await chamar(importador.default, "/api/gestao-ads-ml", { metodo: "POST", corpo: { clienteId: a.id, contaId: ml.id, de: "2026-10-29", ate: "2026-10-30", hoje: "2026-10-31" }, cookie });
    assert.equal(r.status, 401);
    // sem login da Gestão
    r = await chamar(importador.default, "/api/gestao-ads-ml", { metodo: "POST", corpo: { clienteId: a.id, contaId: ml.id, de: "2026-10-29", ate: "2026-10-30" }, cookie: cookieMl() });
    assert.equal(r.status, 401);
    novo.restaurar();
  } finally {
    sim.restaurar();
  }
});
