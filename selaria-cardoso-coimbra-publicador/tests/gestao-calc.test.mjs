import test from "node:test";
import assert from "node:assert/strict";
import {
  addDias, addMeses, agrupar, chavePeriodo, chaveSemana, contarTarefas, corContraMeta, diaValido, diasDoMes, hojeSP, indicadores,
  inicioSemana, lerNumero, periodoValido, recortar, resumir, somar, statusMeta, valorAtualDaMeta,
} from "../public/gestao/calc.mjs";

test("semana ISO bate com a referência (virada de ano, semana 53)", () => {
  // valores de referência gerados com datetime.isocalendar() do Python
  const esperado = {
    "2025-12-29": "2026-W01", "2026-01-01": "2026-W01", "2026-01-04": "2026-W01", "2026-01-05": "2026-W02",
    "2026-10-31": "2026-W44", "2026-12-31": "2026-W53", "2027-01-01": "2026-W53", "2027-01-03": "2026-W53",
    "2024-12-30": "2025-W01", "2020-12-31": "2020-W53", "2021-01-03": "2020-W53",
  };
  for (const [dia, semana] of Object.entries(esperado)) assert.equal(chaveSemana(dia), semana, dia);
});

test("a semana começa na segunda-feira", () => {
  assert.equal(inicioSemana("2026-10-31"), "2026-10-26"); // sábado
  assert.equal(inicioSemana("2026-10-26"), "2026-10-26"); // segunda
  assert.equal(inicioSemana("2026-11-01"), "2026-10-26"); // domingo ainda é a mesma semana
});

test("datas: validação e aritmética", () => {
  assert.equal(diaValido("2026-02-29"), false);
  assert.equal(diaValido("2028-02-29"), true);
  assert.equal(diaValido("2026-13-01"), false);
  assert.equal(diaValido("26-01-01"), false);
  assert.equal(addDias("2026-10-31", 1), "2026-11-01");
  assert.equal(addDias("2026-03-01", -1), "2026-02-28");
  assert.equal(addMeses("2026-01", -1), "2025-12");
  assert.equal(addMeses("2026-11", 2), "2027-01");
  assert.equal(diasDoMes("2026-02").length, 28);
  assert.equal(diasDoMes("2028-02").length, 29);
});

test("hoje no horário de Brasília, mesmo quando em UTC já virou o dia", () => {
  assert.equal(hojeSP(new Date("2026-11-01T02:30:00Z")), "2026-10-31"); // 23:30 em Brasília
  assert.equal(hojeSP(new Date("2026-11-01T03:30:00Z")), "2026-11-01");
});

test("tarefas: a chave do período muda sozinha (diária, semanal, mensal)", () => {
  assert.equal(chavePeriodo("diaria", "2026-10-31"), "D:2026-10-31");
  assert.equal(chavePeriodo("semanal", "2026-10-31"), "W:2026-W44");
  assert.equal(chavePeriodo("semanal", "2026-11-01"), "W:2026-W44");
  assert.equal(chavePeriodo("semanal", "2026-11-02"), "W:2026-W45");
  assert.equal(chavePeriodo("mensal", "2026-10-31"), "M:2026-10");
  assert.equal(chavePeriodo("mensal", "2026-11-01"), "M:2026-11");
  assert.ok(periodoValido("diaria", "D:2026-10-31"));
  assert.ok(!periodoValido("diaria", "W:2026-W44"));
  assert.ok(!periodoValido("semanal", "W:2026-W54"));
  assert.ok(!periodoValido("mensal", "M:2026-13"));
});

test("contagem de tarefas considera só o período corrente", () => {
  const tarefas = [
    { id: "a", frequencia: "diaria" }, { id: "b", frequencia: "diaria" }, { id: "c", frequencia: "diaria", ativo: false },
    { id: "d", frequencia: "semanal" },
  ];
  const reg = {
    "a|D:2026-10-31": { status: "ok" },
    "b|D:2026-10-31": { status: "nao_ok", motivo: "x" },
    "a|D:2026-10-30": { status: "ok" }, // ontem não conta para hoje
    "d|W:2026-W44": { status: "ok" },
  };
  assert.deepEqual(contarTarefas(tarefas, reg, "diaria", "2026-10-31"), { total: 2, ok: 1, naoOk: 1, pendentes: 0 });
  assert.deepEqual(contarTarefas(tarefas, reg, "diaria", "2026-11-01"), { total: 2, ok: 0, naoOk: 0, pendentes: 2 });
  assert.deepEqual(contarTarefas(tarefas, reg, "semanal", "2026-11-01"), { total: 1, ok: 1, naoOk: 0, pendentes: 0 });
  assert.deepEqual(contarTarefas(tarefas, reg, "semanal", "2026-11-02"), { total: 1, ok: 0, naoOk: 0, pendentes: 1 });
});

test("indicadores: TACOS, ACoS, ROAS, CPC, conversão e ticket médio", () => {
  const s = { gasto: 40, fatTotal: 1000, fatAds: 400, pedidos: 20, pedidosAds: 8, cliques: 200, impressoes: 10000 };
  const i = indicadores(s);
  assert.equal(i.tacos, 4);
  assert.equal(i.acos, 10);
  assert.equal(i.roas, 10);
  assert.equal(i.cpc, 0.2);
  assert.equal(i.ctr, 2);
  assert.equal(i.conversao, 4);
  assert.equal(i.ticketMedio, 50);
});

test("indicadores sem denominador voltam nulos, nunca NaN nem Infinity", () => {
  const i = indicadores(somar([]));
  for (const v of Object.values(i)) assert.equal(v, null);
  const so_gasto = indicadores(somar([{ gasto: 10 }]));
  assert.equal(so_gasto.tacos, null);
  assert.equal(so_gasto.roas, 0);
});

test("semana e mês somam e recalculam: NÃO é média de percentuais", () => {
  // dia 1: gasta 10 de 100 (TACOS 10%). dia 2: gasta 10 de 900 (TACOS ~1,11%).
  const dias = {
    "2026-10-26": { gasto: 10, fatTotal: 100, fatAds: 100, pedidos: 1, pedidosAds: 1, cliques: 10, impressoes: 100 },
    "2026-10-27": { gasto: 10, fatTotal: 900, fatAds: 500, pedidos: 9, pedidosAds: 5, cliques: 30, impressoes: 300 },
  };
  const [semana] = agrupar(dias, "semana");
  assert.equal(semana.gasto, 20);
  assert.equal(semana.fatTotal, 1000);
  assert.equal(semana.tacos, 2); // 20 / 1000, e não (10 + 1,11) / 2 = 5,56
  assert.equal(semana.cpc, 0.5); // 20 / 40 cliques
  assert.equal(semana.dias, 2);
});

test("agrupar: dia, semana e mês, mais recente primeiro, semana atravessando o mês", () => {
  const dias = {
    "2026-10-30": { gasto: 1, fatTotal: 10 },
    "2026-10-31": { gasto: 2, fatTotal: 10 },
    "2026-11-01": { gasto: 4, fatTotal: 10 }, // domingo: ainda é a semana de 26/10
    "2026-11-02": { gasto: 8, fatTotal: 10 }, // segunda: semana nova
  };
  const porDia = agrupar(dias, "dia");
  assert.deepEqual(porDia.map((l) => l.chave), ["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30"]);
  const porSemana = agrupar(dias, "semana");
  assert.deepEqual(porSemana.map((l) => [l.chave, l.gasto]), [["2026-W45", 8], ["2026-W44", 7]]);
  const porMes = agrupar(dias, "mes");
  assert.deepEqual(porMes.map((l) => [l.chave, l.gasto]), [["2026-11", 12], ["2026-10", 3]]);
});

test("soma de dinheiro sem erro de ponto flutuante", () => {
  const itens = Array.from({ length: 10 }, () => ({ gasto: 0.1, fatTotal: 0.2 }));
  const s = somar(itens);
  assert.equal(s.gasto, 1);
  assert.equal(s.fatTotal, 2);
});

test("metas: teto (TACOS) e piso (faturamento)", () => {
  assert.equal(statusMeta({ alvo: 4, sentido: "max" }, 3.9).estado, "ok");
  assert.equal(statusMeta({ alvo: 4, sentido: "max" }, 4).estado, "ok");
  assert.equal(statusMeta({ alvo: 4, sentido: "max" }, 4.5).estado, "atencao");
  assert.equal(statusMeta({ alvo: 4, sentido: "max" }, 5).estado, "fora");
  assert.equal(statusMeta({ alvo: 10000, sentido: "min" }, 10000).estado, "ok");
  assert.equal(statusMeta({ alvo: 10000, sentido: "min" }, 8500).estado, "atencao");
  assert.equal(statusMeta({ alvo: 10000, sentido: "min" }, 5000).estado, "fora");
  assert.equal(statusMeta({ alvo: 4, sentido: "max" }, null).estado, "sem_dado");
  assert.equal(corContraMeta(5, 4), "fora");
  assert.equal(corContraMeta(null, 4), "neutro");
});

test("valor atual da meta usa a janela certa (dia, semana, mês)", () => {
  const dias = {
    "2026-10-05": { gasto: 100, fatTotal: 1000 },
    "2026-10-27": { gasto: 10, fatTotal: 1000 },
    "2026-10-31": { gasto: 30, fatTotal: 1000 },
  };
  const hoje = "2026-10-31";
  assert.equal(valorAtualDaMeta({ metrica: "gasto", periodo: "dia" }, dias, hoje), 30);
  assert.equal(valorAtualDaMeta({ metrica: "gasto", periodo: "semana" }, dias, hoje), 40);
  assert.equal(valorAtualDaMeta({ metrica: "gasto", periodo: "mes" }, dias, hoje), 140);
  assert.equal(valorAtualDaMeta({ metrica: "tacos", periodo: "mes" }, dias, hoje), (140 / 3000) * 100);
  assert.equal(valorAtualDaMeta({ metrica: "tacos", periodo: "dia" }, {}, hoje), null);
  assert.equal(valorAtualDaMeta({ metrica: "custom", atualManual: 7 }, dias, hoje), 7);
});

test("recortar e resumir", () => {
  const dias = { "2026-10-01": { gasto: 1 }, "2026-10-15": { gasto: 2 }, "2026-10-31": { gasto: 4 } };
  assert.deepEqual(Object.keys(recortar(dias, "2026-10-10", "2026-10-31")), ["2026-10-15", "2026-10-31"]);
  assert.equal(resumir(Object.values(dias)).gasto, 7);
});

test("lerNumero aceita formato brasileiro e americano", () => {
  assert.equal(lerNumero("1.234,56"), 1234.56);
  assert.equal(lerNumero("R$ 12,5"), 12.5);
  assert.equal(lerNumero("1234.56"), 1234.56);
  assert.equal(lerNumero("4%"), 4);
  assert.equal(lerNumero(""), null);
  assert.equal(lerNumero("abc"), null);
});

test("colar da planilha: Excel (tab), ponto e vírgula, datas BR, cabeçalho e linhas com erro", async () => {
  const { parsearPlanilha } = await import("../public/gestao/calc.mjs");
  const texto = [
    "Data\tGasto\tFat. total\tFat. ads\tPedidos\tCliques\tImpressões",
    "30/10/2026\t12,50\t1.000,00\t300\t8\t90\t4000",
    "2026-10-31;20;1500;;10",
    "31/02/2026;1;2",
    "01/11/2026\tabc\t5",
  ].join("\n");
  const r = parsearPlanilha(texto);
  assert.deepEqual(r.dias["2026-10-30"], { gasto: 12.5, fatTotal: 1000, fatAds: 300, pedidos: 8, pedidosAds: 0, cliques: 90, impressoes: 4000, fonte: "planilha" });
  assert.equal(r.dias["2026-10-31"].gasto, 20);
  assert.equal(r.dias["2026-10-31"].fatAds, 0);
  assert.equal(r.dias["2026-10-31"].pedidos, 10);
  assert.equal(Object.keys(r.dias).length, 2);
  assert.deepEqual(r.erros.map((e) => e.linha), [4, 5]);
});

test("datas comerciais sugeridas caem nos dias certos de 2026", async () => {
  const { datasSugeridas } = await import("../public/gestao/calc.mjs");
  const d = Object.fromEntries(datasSugeridas(2026).map((x) => [x.nome, x.data]));
  assert.equal(d["Dia das Mães"], "2026-05-10"); // 2º domingo de maio de 2026
  assert.equal(d["Dia dos Pais"], "2026-08-09"); // 2º domingo de agosto de 2026
  assert.equal(d["Black Friday"], "2026-11-27"); // 4ª sexta de novembro de 2026
  assert.equal(d["Cyber Monday"], "2026-11-30");
  assert.equal(d["Natal"], "2026-12-25");
});
