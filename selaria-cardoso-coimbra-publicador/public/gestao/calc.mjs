// Cálculos da Gestão de Clientes. Funções puras, sem DOM e sem rede:
// o mesmo arquivo roda no navegador (admin e portal do cliente) e nos testes.
//
// Regra de ouro: semana e mês SOMAM os valores do período e só depois recalculam
// os percentuais. Nunca se tira média de percentuais diários.

export const FUSO = "America/Sao_Paulo";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// ---------- datas (sempre texto AAAA-MM-DD, aritmética em UTC para não sofrer com fuso) ----------

export function diaValido(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function mesValido(s) {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

function paraData(dia) {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
function deData(dt) {
  return dt.toISOString().slice(0, 10);
}

// "Hoje" no horário de Brasília, mesmo que o computador esteja em outro fuso.
export function hojeSP(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function addDias(dia, n) {
  const dt = paraData(dia);
  dt.setUTCDate(dt.getUTCDate() + n);
  return deData(dt);
}

export function addMeses(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1 + n, 1));
  return dt.toISOString().slice(0, 7);
}

export function mesDe(dia) {
  return dia.slice(0, 7);
}

export function primeiroDiaDoMes(mes) {
  return mes + "-01";
}

export function ultimoDiaDoMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  return deData(new Date(Date.UTC(a, m, 0)));
}

export function diasDoMes(mes) {
  const ult = Number(ultimoDiaDoMes(mes).slice(8));
  return Array.from({ length: ult }, (_, i) => mes + "-" + String(i + 1).padStart(2, "0"));
}

export function diaDaSemana(dia) {
  return paraData(dia).getUTCDay(); // 0 = domingo
}

// Semana ISO: segunda a domingo. A semana pertence ao ano da sua quinta-feira.
export function inicioSemana(dia) {
  const dt = paraData(dia);
  const dow = (dt.getUTCDay() + 6) % 7; // segunda = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return deData(dt);
}

export function fimSemana(dia) {
  return addDias(inicioSemana(dia), 6);
}

export function chaveSemana(dia) {
  const seg = paraData(inicioSemana(dia));
  const quinta = new Date(seg.getTime());
  quinta.setUTCDate(seg.getUTCDate() + 3);
  const ano = quinta.getUTCFullYear();
  const jan1 = Date.UTC(ano, 0, 1);
  const semana = 1 + Math.floor((quinta.getTime() - jan1) / 86400000 / 7);
  return ano + "-W" + String(semana).padStart(2, "0");
}

export function formatarDia(dia) {
  const [a, m, d] = dia.split("-");
  return d + "/" + m + "/" + a;
}
export function formatarDiaCurto(dia) {
  const [, m, d] = dia.split("-");
  return d + "/" + m;
}
export function nomeMes(mes) {
  const [a, m] = mes.split("-");
  return MESES[Number(m) - 1] + "/" + a;
}

// ---------- períodos das tarefas recorrentes ----------

export const FREQUENCIAS = ["diaria", "semanal", "mensal"];
export const ROTULO_FREQ = { diaria: "Diárias", semanal: "Semanais", mensal: "Mensais" };

// A chave muda sozinha quando o período vira. Por isso a tarefa "zera" sem nenhum agendador:
// o registro de ontem continua guardado, o de hoje simplesmente ainda não existe.
export function chavePeriodo(freq, dia) {
  if (freq === "diaria") return "D:" + dia;
  if (freq === "semanal") return "W:" + chaveSemana(dia);
  if (freq === "mensal") return "M:" + mesDe(dia);
  throw new Error("Frequência inválida: " + freq);
}

export function periodoValido(freq, chave) {
  if (typeof chave !== "string") return false;
  if (freq === "diaria") return chave.startsWith("D:") && diaValido(chave.slice(2));
  if (freq === "semanal") return /^W:\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(chave);
  if (freq === "mensal") return chave.startsWith("M:") && mesValido(chave.slice(2));
  return false;
}

export function descricaoPeriodo(freq, dia) {
  if (freq === "diaria") return formatarDia(dia);
  if (freq === "semanal") return formatarDiaCurto(inicioSemana(dia)) + " a " + formatarDiaCurto(fimSemana(dia));
  return nomeMes(mesDe(dia));
}

export function anoDaChave(chave) {
  return chave.slice(2, 6);
}

// ---------- resultado de Ads ----------

const CAMPOS_SOMA = ["gasto", "fatTotal", "fatAds", "pedidos", "pedidosAds", "cliques", "impressoes"];

const cent = (v) => Math.round((Number(v) || 0) * 100);

// Soma uma lista de lançamentos diários. Dinheiro é somado em centavos inteiros para não acumular erro de arredondamento.
export function somar(lancamentos) {
  const t = { gasto: 0, fatTotal: 0, fatAds: 0, pedidos: 0, pedidosAds: 0, cliques: 0, impressoes: 0, dias: 0 };
  for (const l of lancamentos) {
    if (!l) continue;
    t.gasto += cent(l.gasto);
    t.fatTotal += cent(l.fatTotal);
    t.fatAds += cent(l.fatAds);
    t.pedidos += Number(l.pedidos) || 0;
    t.pedidosAds += Number(l.pedidosAds) || 0;
    t.cliques += Number(l.cliques) || 0;
    t.impressoes += Number(l.impressoes) || 0;
    t.dias += 1;
  }
  t.gasto /= 100;
  t.fatTotal /= 100;
  t.fatAds /= 100;
  return t;
}

const razao = (a, b) => (b > 0 ? a / b : null);

// TACOS = gasto ÷ faturamento TOTAL (ads + orgânico). ACoS = gasto ÷ faturamento vindo de ads.
// ROAS = faturamento de ads ÷ gasto. CPC = gasto ÷ cliques. Conversão = pedidos de ads ÷ cliques.
export function indicadores(s) {
  const pct = (v) => (v == null ? null : v * 100);
  return {
    tacos: pct(razao(s.gasto, s.fatTotal)),
    acos: pct(razao(s.gasto, s.fatAds)),
    roas: razao(s.fatAds, s.gasto),
    cpc: razao(s.gasto, s.cliques),
    ctr: pct(razao(s.cliques, s.impressoes)),
    conversao: s.pedidosAds > 0 || s.cliques > 0 ? pct(razao(s.pedidosAds, s.cliques)) : null,
    ticketMedio: razao(s.fatTotal, s.pedidos),
  };
}

export function resumir(lancamentos) {
  const s = somar(lancamentos);
  return { ...s, ...indicadores(s) };
}

export function chaveAgrupamento(agrupamento, dia) {
  if (agrupamento === "dia") return dia;
  if (agrupamento === "semana") return chaveSemana(dia);
  if (agrupamento === "mes") return mesDe(dia);
  throw new Error("Agrupamento inválido: " + agrupamento);
}

function rotuloGrupo(agrupamento, dia) {
  if (agrupamento === "dia") return formatarDia(dia);
  if (agrupamento === "semana") return formatarDiaCurto(inicioSemana(dia)) + " a " + formatarDiaCurto(fimSemana(dia));
  return nomeMes(mesDe(dia));
}

// diasObj: { "2026-10-31": {gasto, fatTotal, ...}, ... }  ->  linhas por dia, semana ou mês (mais recente primeiro).
export function agrupar(diasObj, agrupamento) {
  const grupos = new Map();
  for (const [dia, l] of Object.entries(diasObj || {})) {
    if (!diaValido(dia) || !l) continue;
    const chave = chaveAgrupamento(agrupamento, dia);
    if (!grupos.has(chave)) grupos.set(chave, { chave, dias: [], itens: [] });
    const g = grupos.get(chave);
    g.dias.push(dia);
    g.itens.push(l);
  }
  const linhas = [];
  for (const g of grupos.values()) {
    g.dias.sort();
    const primeiro = g.dias[0];
    linhas.push({
      chave: g.chave,
      rotulo: rotuloGrupo(agrupamento, primeiro),
      inicio: agrupamento === "dia" ? primeiro : agrupamento === "semana" ? inicioSemana(primeiro) : primeiroDiaDoMes(mesDe(primeiro)),
      ...resumir(g.itens),
    });
  }
  linhas.sort((a, b) => (a.inicio < b.inicio ? 1 : a.inicio > b.inicio ? -1 : 0));
  return linhas;
}

// Filtra um objeto de dias entre duas datas (inclusive).
export function recortar(diasObj, de, ate) {
  const saida = {};
  for (const [dia, l] of Object.entries(diasObj || {})) {
    if (dia >= de && dia <= ate) saida[dia] = l;
  }
  return saida;
}

// ---------- metas ----------

export const METRICAS = {
  faturamento: { rotulo: "Faturamento total", unidade: "R$", sentido: "min", campo: "fatTotal" },
  gasto: { rotulo: "Gasto com Ads", unidade: "R$", sentido: "max", campo: "gasto" },
  tacos: { rotulo: "TACOS", unidade: "%", sentido: "max", campo: "tacos" },
  acos: { rotulo: "ACoS", unidade: "%", sentido: "max", campo: "acos" },
  roas: { rotulo: "ROAS", unidade: "x", sentido: "min", campo: "roas" },
  cpc: { rotulo: "CPC", unidade: "R$", sentido: "max", campo: "cpc" },
  conversao: { rotulo: "Conversão de Ads", unidade: "%", sentido: "min", campo: "conversao" },
  ticket_medio: { rotulo: "Ticket médio", unidade: "R$", sentido: "min", campo: "ticketMedio" },
  pedidos: { rotulo: "Pedidos", unidade: "un", sentido: "min", campo: "pedidos" },
  custom: { rotulo: "Meta livre", unidade: "", sentido: "min", campo: null },
};

// Período de apuração da meta, a partir de "hoje".
export function janelaDaMeta(periodo, hoje) {
  if (periodo === "dia") return { de: hoje, ate: hoje };
  if (periodo === "semana") return { de: inicioSemana(hoje), ate: hoje };
  return { de: primeiroDiaDoMes(mesDe(hoje)), ate: hoje };
}

// Valor atual da meta com base nos lançamentos da conta.
export function valorAtualDaMeta(meta, diasObj, hoje) {
  const info = METRICAS[meta.metrica];
  if (!info || !info.campo) return meta.atualManual == null ? null : Number(meta.atualManual);
  const { de, ate } = janelaDaMeta(meta.periodo, hoje);
  const recorte = recortar(diasObj, de, ate);
  if (!Object.keys(recorte).length) return null;
  const r = resumir(Object.values(recorte));
  const v = r[info.campo];
  return v == null ? null : v;
}

// estado: sem_dado | ok | atencao | fora.  progresso: 0..1 (ou mais) para a barra.
export function statusMeta(meta, atual) {
  const alvo = Number(meta.alvo);
  if (atual == null || !Number.isFinite(alvo) || alvo <= 0) return { estado: "sem_dado", progresso: 0 };
  if (meta.sentido === "max") {
    // quanto menor, melhor (TACOS, CPC...). 15% de folga vira "atenção".
    const estado = atual <= alvo ? "ok" : atual <= alvo * 1.15 ? "atencao" : "fora";
    return { estado, progresso: Math.min(atual / alvo, 1.5) };
  }
  const p = atual / alvo;
  return { estado: p >= 1 ? "ok" : p >= 0.8 ? "atencao" : "fora", progresso: Math.min(p, 1.5) };
}

// Cor de um valor frente a uma meta de "teto" (TACOS, CPC).
export function corContraMeta(valor, alvo) {
  if (valor == null || alvo == null) return "neutro";
  return statusMeta({ alvo, sentido: "max" }, valor).estado;
}

// ---------- tarefas ----------

export const chaveRegistro = (tarefaId, periodo) => tarefaId + "|" + periodo;

// Contagem de uma frequência no período que contém `dia`.
export function contarTarefas(tarefas, registros, freq, dia) {
  const periodo = chavePeriodo(freq, dia);
  let total = 0, ok = 0, naoOk = 0;
  for (const t of tarefas) {
    if (t.ativo === false || t.frequencia !== freq) continue;
    total += 1;
    const r = registros[chaveRegistro(t.id, periodo)];
    if (r && r.status === "ok") ok += 1;
    else if (r && r.status === "nao_ok") naoOk += 1;
  }
  return { total, ok, naoOk, pendentes: total - ok - naoOk };
}

// ---------- formatação ----------

export function moeda(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function numero(v, casas = 0) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
export function percentual(v, casas = 1) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return numero(v, casas) + "%";
}
export function formatarMetrica(metrica, v) {
  const u = METRICAS[metrica]?.unidade;
  if (u === "R$") return moeda(v);
  if (u === "%") return percentual(v);
  if (u === "x") return v == null ? "—" : numero(v, 2) + "x";
  return numero(v, v != null && !Number.isInteger(Number(v)) ? 2 : 0);
}

// Converte "1.234,56" ou "1234.56" em número. Devolve null quando vazio ou inválido.
export function lerNumero(txt) {
  if (txt == null) return null;
  let s = String(txt).trim().replace(/[R$\s%]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- colar da planilha (Shopee e outras fontes sem importação automática) ----------
// Cada linha: data ; gasto ; faturamento total ; faturamento de ads ; pedidos ; cliques ; impressões
// Separador: tabulação (colado do Excel/Sheets) ou ponto e vírgula. A data pode ser DD/MM/AAAA ou AAAA-MM-DD.
export function parsearPlanilha(texto) {
  const dias = {};
  const erros = [];
  const linhas = String(texto || "").split(/\r?\n/);
  let viuDado = false;
  linhas.forEach((bruta, i) => {
    if (!bruta.trim()) return;
    const c = bruta.split(/\t|;/).map((x) => x.trim());
    let dia = null;
    const br = c[0].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) dia = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(c[0])) dia = c[0];
    if (!dia || !diaValido(dia)) {
      if (viuDado || /\d/.test(c[0])) erros.push({ linha: i + 1, motivo: "Data inválida: " + c[0].slice(0, 20) });
      return; // cabeçalho
    }
    viuDado = true;
    const nums = c.slice(1, 7).map((x) => (x === "" ? 0 : lerNumero(x)));
    if (nums.some((n) => n == null || n < 0)) { erros.push({ linha: i + 1, motivo: "Número inválido" }); return; }
    const [gasto = 0, fatTotal = 0, fatAds = 0, pedidos = 0, cliques = 0, impressoes = 0] = nums;
    dias[dia] = { gasto, fatTotal, fatAds, pedidos, pedidosAds: 0, cliques, impressoes, fonte: "planilha" };
  });
  return { dias, erros };
}

// ---------- datas comerciais sugeridas ----------
function enesimo(ano, mes, diaSemana, n) {
  // n-ésimo dia da semana (0 = domingo) do mês
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const dia = 1 + ((diaSemana - primeiro + 7) % 7) + (n - 1) * 7;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function datasSugeridas(ano) {
  const fixa = (m, d) => `${ano}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const blackFriday = enesimo(ano, 11, 5, 4);
  return [
    { nome: "Dia das Mães", data: enesimo(ano, 5, 0, 2) },
    { nome: "Dia dos Namorados", data: fixa(6, 12) },
    { nome: "Dia dos Pais", data: enesimo(ano, 8, 0, 2) },
    { nome: "9.9", data: fixa(9, 9) },
    { nome: "Dia do Cliente", data: fixa(9, 15) },
    { nome: "10.10", data: fixa(10, 10) },
    { nome: "11.11", data: fixa(11, 11) },
    { nome: "Black Friday", data: blackFriday },
    { nome: "Cyber Monday", data: addDias(blackFriday, 3) },
    { nome: "Natal", data: fixa(12, 25) },
  ];
}
