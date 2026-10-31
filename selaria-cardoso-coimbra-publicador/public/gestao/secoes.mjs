// Telas compartilhadas: Resumo, Tarefas, Metas e Prioridades.
// Cada função recebe o "ctx" (dados + ações) e devolve um elemento. No portal do cliente o ctx vem
// com modo "cliente": as mesmas telas aparecem sem os controles de edição.
import {
  FREQUENCIAS, METRICAS, ROTULO_FREQ, addDias, addMeses, chavePeriodo, chaveRegistro, contarTarefas, descricaoPeriodo, formatarDia,
  formatarMetrica, mesDe, nomeMes, percentual, moeda, recortar, resumir, statusMeta, valorAtualDaMeta,
} from "./calc.mjs";
import { ROTULO_ESTADO, barra, botao, chip, chipMarketplace, el, formulario, icone, ponto, soma2, vazio, confirmar } from "./ui.mjs";

const ehAdmin = (ctx) => ctx.modo === "admin";

// ---------- utilidades de dados ----------

export function contasComAds(ctx) {
  return ctx.dados.contas.filter((c) => (ehAdmin(ctx) ? true : c.adsVisivel));
}

export function nomeConta(ctx, id) {
  return ctx.dados.contas.find((c) => c.id === id)?.nome || null;
}

export function diasDaConta(ctx, contaId) {
  const meses = ctx.dados.ads?.[contaId] || {};
  return Object.assign({}, ...Object.values(meses));
}

// Soma dia a dia de todas as contas (para metas "gerais", sem conta específica).
export function diasGeral(ctx) {
  return contasComAds(ctx).reduce((acc, c) => soma2(acc, diasDaConta(ctx, c.id)), {});
}

export function metaTacosDe(ctx, contaId, periodo = "mes") {
  const todas = ctx.dados.metas.filter((m) => m.metrica === "tacos" && (m.contaId === contaId));
  return todas.find((m) => m.periodo === periodo) || todas[0] || null;
}

const seletorConta = (ctx, valor, comGeral = true) => [
  ...(comGeral ? [["", "Todas as contas (geral)"]] : [["", "—"]]),
  ...ctx.dados.contas.map((c) => [c.id, `${c.nome} (${c.marketplace === "ml" ? "ML" : c.marketplace === "shopee" ? "Shopee" : "TikTok"})`]),
];

function botaoOlho(oculto, aoAlternar) {
  return botao("", {
    iconeNome: oculto ? "olhoFechado" : "olho",
    classe: "g-mini g-fantasma",
    titulo: oculto ? "Oculto para o cliente (clique para mostrar)" : "Visível para o cliente (clique para ocultar)",
    onClick: aoAlternar,
  });
}

// ====================================================================== RESUMO

export function secaoResumo(ctx) {
  const raiz = el("div");
  const hoje = ctx.hoje;
  const mes = mesDe(hoje);
  const contas = contasComAds(ctx);

  raiz.append(el("div", { class: "g-secao-titulo" }, el("h2", { text: "Resumo de " + nomeMes(mes) }), el("span", { class: "g-sub", text: "Hoje é " + formatarDia(hoje) })));

  if (contas.length) {
    const grade = el("div", { class: "g-grid g-c3" });
    for (const c of contas) {
      const dias = diasDaConta(ctx, c.id);
      const r = resumir(Object.values(recortar(dias, mes + "-01", hoje)));
      const meta = metaTacosDe(ctx, c.id);
      const st = meta && r.tacos != null ? statusMeta(meta, r.tacos).estado : "sem_dado";
      grade.append(el("div", { class: "g-card" },
        el("div", { class: "g-linha g-entre" }, el("h3", { text: c.nome }), chipMarketplace(c.marketplace)),
        el("div", { class: "g-kpi-rotulo", text: "TACOS do mês" }),
        el("div", { class: "g-kpi-valor g-cor-" + (st === "sem_dado" ? "neutro" : st), text: percentual(r.tacos), estilo: { "font-size": "30px", "font-weight": "700" } }),
        el("div", { class: "g-sub", text: meta ? `Meta: até ${percentual(meta.alvo)}` + (st !== "sem_dado" ? " · " + ROTULO_ESTADO[st] : "") : "Sem meta de TACOS definida" }),
        el("div", { class: "g-linha g-entre", estilo: { "margin-top": "12px" } },
          el("div", {}, el("div", { class: "g-kpi-rotulo", text: "Gasto Ads" }), el("strong", { text: moeda(r.gasto) })),
          el("div", {}, el("div", { class: "g-kpi-rotulo", text: "Faturamento" }), el("strong", { text: moeda(r.fatTotal) })),
          el("div", {}, el("div", { class: "g-kpi-rotulo", text: "Dias" }), el("strong", { text: String(r.dias) })))));
    }
    raiz.append(grade);
  }

  // tarefas do período corrente
  const registros = ctx.dados.registros;
  const tarefas = ctx.dados.tarefas.filter((t) => t.ativo !== false);
  const blocoT = el("div", { class: "g-card" }, el("h3", { text: "Minhas tarefas agora" }));
  const gradeT = el("div", { class: "g-grid g-c3" });
  for (const f of FREQUENCIAS) {
    const n = contarTarefas(tarefas, registros, f, hoje);
    const fracao = n.total ? (n.ok + n.naoOk) / n.total : 0;
    gradeT.append(el("div", {},
      el("div", { class: "g-linha g-entre" }, el("strong", { text: ROTULO_FREQ[f] }), el("span", { class: "g-sub", text: `${n.ok}/${n.total} OK` })),
      barra(fracao, n.total && n.ok === n.total ? "ok" : ""),
      el("div", { class: "g-sub", text: n.total ? (n.naoOk ? `${n.naoOk} não OK · ` : "") + `${n.pendentes} pendente(s) · ${descricaoPeriodo(f, hoje)}` : "Nenhuma tarefa" })));
  }
  blocoT.append(gradeT);
  raiz.append(blocoT);

  // metas que precisam de atenção
  const alertas = [];
  for (const m of ctx.dados.metas) {
    const dias = m.contaId ? diasDaConta(ctx, m.contaId) : diasGeral(ctx);
    const atual = valorAtualDaMeta(m, dias, hoje);
    const st = statusMeta(m, atual);
    if (st.estado === "fora" || st.estado === "atencao") alertas.push({ m, atual, st });
  }
  const blocoM = el("div", { class: "g-card" }, el("h3", { text: "Metas que pedem atenção" }));
  if (!alertas.length) blocoM.append(el("div", { class: "g-sub", text: ctx.dados.metas.length ? "Nenhuma meta fora do alvo. 👏" : "Ainda não há metas cadastradas." }));
  for (const a of alertas.slice(0, 6)) {
    blocoM.append(el("div", { class: "g-conta-linha", estilo: { padding: "5px 0" } }, ponto(a.st.estado),
      el("span", { class: "g-nome", text: `${a.m.rotulo}${a.m.contaId ? " · " + (nomeConta(ctx, a.m.contaId) || "") : ""}` }),
      el("strong", { text: `${formatarMetrica(a.m.metrica, a.atual)} / ${formatarMetrica(a.m.metrica, a.m.alvo)}` })));
  }
  raiz.append(blocoM);

  // prioridades abertas
  const abertas = ctx.dados.prioridades.filter((p) => p.status === "nova" || p.status === "em_andamento");
  const blocoP = el("div", { class: "g-card" }, el("h3", { text: ehAdmin(ctx) ? "O que o cliente quer priorizar" : "Suas prioridades em aberto" }));
  if (!abertas.length) blocoP.append(el("div", { class: "g-sub", text: "Nenhuma prioridade em aberto." }));
  for (const p of abertas.slice(0, 5)) blocoP.append(el("div", { class: "g-conta-linha", estilo: { padding: "5px 0" } }, chip(p.urgencia === "alta" ? "Alta" : p.urgencia === "baixa" ? "Baixa" : "Média", p.urgencia === "alta" ? "g-fora" : p.urgencia === "baixa" ? "g-neutro" : "g-atencao"), el("span", { class: "g-nome", text: p.titulo }), chip(STATUS_PRIORIDADE_ROTULO[p.status], p.status === "nova" ? "g-amarelo" : "")));
  raiz.append(blocoP);
  return raiz;
}

// ====================================================================== TAREFAS

const PASSO = { diaria: (d, n) => addDias(d, n), semanal: (d, n) => addDias(d, 7 * n), mensal: (d, n) => addMeses(mesDe(d), n) + "-01" };

export function secaoTarefas(ctx) {
  const ui = (ctx.ui.tarefas ||= { freq: "diaria", dia: ctx.hoje });
  const admin = ehAdmin(ctx);
  const raiz = el("div");
  const periodo = chavePeriodo(ui.freq, ui.dia);
  const lista = ctx.dados.tarefas
    .filter((t) => t.frequencia === ui.freq && t.ativo !== false)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const regDe = (t) => ctx.dados.registros[chaveRegistro(t.id, periodo)];
  const feitas = lista.filter((t) => regDe(t)?.status === "ok").length;
  const naoOk = lista.filter((t) => regDe(t)?.status === "nao_ok").length;

  raiz.append(el("div", { class: "g-secao-titulo" }, el("h2", { text: "Tarefas" }),
    admin ? botao("Nova tarefa", { iconeNome: "mais", classe: "g-primario", onClick: () => editarTarefa(ctx, null, ui.freq) }) : null));

  const abas = el("div", { class: "g-segmentos", role: "group", "aria-label": "Frequência" },
    FREQUENCIAS.map((f) => el("button", { type: "button", class: "g-segmento", "aria-pressed": String(ui.freq === f), onclick: () => { ui.freq = f; ui.dia = ctx.hoje; ctx.rerender(); } }, ROTULO_FREQ[f])));

  const ehHoje = chavePeriodo(ui.freq, ui.dia) === chavePeriodo(ui.freq, ctx.hoje);
  const nav = el("div", { class: "g-nav-periodo" },
    botao("", { iconeNome: "esq", classe: "g-mini", titulo: "Período anterior", onClick: () => { ui.dia = PASSO[ui.freq](ui.dia, -1); ctx.rerender(); } }),
    el("span", { class: "g-periodo-rotulo", text: descricaoPeriodo(ui.freq, ui.dia) + (ehHoje ? " (atual)" : "") }),
    botao("", { iconeNome: "dir", classe: "g-mini", titulo: "Próximo período", onClick: () => { ui.dia = PASSO[ui.freq](ui.dia, 1); ctx.rerender(); } }),
    ehHoje ? null : botao("Voltar para o atual", { classe: "g-mini", onClick: () => { ui.dia = ctx.hoje; ctx.rerender(); } }));

  raiz.append(el("div", { class: "g-linha g-entre", estilo: { "margin-bottom": "12px" } }, abas, nav));
  raiz.append(el("div", { class: "g-card" },
    el("div", { class: "g-linha g-entre" }, el("strong", { text: `${feitas} de ${lista.length} concluídas` }), el("span", { class: "g-sub", text: naoOk ? `${naoOk} marcada(s) como não OK` : "" })),
    barra(lista.length ? feitas / lista.length : 0, lista.length && feitas === lista.length ? "ok" : "")));

  if (!lista.length) { raiz.append(el("div", { estilo: { "margin-top": "14px" } }, vazio("Nenhuma tarefa " + ROTULO_FREQ[ui.freq].toLowerCase() + " cadastrada."))); return raiz; }

  const caixa = el("div", { estilo: { "margin-top": "14px" } });
  for (const t of lista) caixa.append(linhaTarefa(ctx, t, periodo, regDe(t)));
  raiz.append(caixa);
  if (admin) raiz.append(el("p", { class: "g-sub g-nao-imprimir", estilo: { "margin-top": "12px" }, text: "O olho define se o cliente enxerga a tarefa. Marcações de dias e semanas anteriores continuam guardadas; ao virar o período a lista começa limpa sozinha." }));
  return raiz;
}

function linhaTarefa(ctx, t, periodo, reg) {
  const admin = ehAdmin(ctx);
  const status = reg?.status || null;
  const caixa = el("button", {
    type: "button", class: "g-check" + (status === "ok" ? " g-on" : ""), disabled: !admin,
    "aria-pressed": String(status === "ok"), "aria-label": `Marcar "${t.titulo}" como OK`,
    onclick: () => ctx.acoes.marcarTarefa(t, periodo, status === "ok" ? null : "ok", status === "ok" ? "" : reg?.motivo || ""),
  }, status === "ok" ? icone("ok", 16) : null);

  const naoOkBtn = el("button", {
    type: "button", class: "g-btn-naook" + (status === "nao_ok" ? " g-on" : ""), disabled: !admin, "aria-pressed": String(status === "nao_ok"),
    onclick: () => ctx.acoes.marcarTarefa(t, periodo, status === "nao_ok" ? null : "nao_ok", reg?.motivo || "", status === "nao_ok" ? null : t.id),
  }, "Não OK");

  const meta = el("div", { class: "g-meta-t" },
    t.categoria ? chip(t.categoria) : null,
    t.contaId && nomeConta(ctx, t.contaId) ? chip(nomeConta(ctx, t.contaId), "g-amarelo") : null,
    admin && t.oculto ? chip("oculta do cliente", "g-neutro") : null);

  const linha = el("div", { class: "g-tarefa g-s-" + (status || "pendente") + (admin && t.oculto ? " g-oculto-marca" : "") },
    caixa,
    el("div", {}, el("div", { class: "g-titulo-t", text: t.titulo }), meta),
    el("div", { class: "g-acoes-t g-nao-imprimir" },
      naoOkBtn,
      admin ? botaoOlho(t.oculto, () => ctx.acoes.salvarLista("tarefas", ctx.dados.tarefas.map((x) => (x.id === t.id ? { ...x, oculto: !x.oculto } : x)))) : null,
      admin ? botao("", { iconeNome: "lapis", classe: "g-mini g-fantasma", titulo: "Editar tarefa", onClick: () => editarTarefa(ctx, t) }) : null,
      admin ? botao("", { iconeNome: "lixo", classe: "g-mini g-fantasma", titulo: "Remover tarefa", onClick: () => removerTarefa(ctx, t) }) : null));

  if (status) {
    if (admin) {
      const entrada = el("input", {
        class: "g-input" + (status === "nao_ok" && !reg?.motivo ? " g-erro" : ""), type: "text", maxlength: 500, id: "motivo-" + t.id,
        placeholder: status === "nao_ok" ? "Por que não foi feito?" : "Observação (opcional)", value: reg?.motivo || "",
        onchange: (ev) => ctx.acoes.marcarTarefa(t, periodo, status, ev.target.value),
      });
      linha.append(el("div", { class: "g-motivo" }, entrada));
    } else if (reg?.motivo) {
      linha.append(el("div", { class: "g-motivo" }, el("div", { class: "g-sub" }, el("b", { text: status === "nao_ok" ? "Motivo: " : "Obs.: " }), reg.motivo)));
    }
  }
  return linha;
}

async function editarTarefa(ctx, tarefa, freqPadrao = "diaria") {
  const v = await formulario({
    titulo: tarefa ? "Editar tarefa" : "Nova tarefa",
    campos: [
      { nome: "titulo", rotulo: "O que precisa ser feito", obrigatorio: true, max: 140 },
      { nome: "frequencia", rotulo: "Frequência", tipo: "select", opcoes: FREQUENCIAS.map((f) => [f, ROTULO_FREQ[f]]) },
      { nome: "categoria", rotulo: "Categoria", max: 40, dica: "Ex.: Ads, Anúncios, Conteúdo, Full, Promoções" },
      { nome: "contaId", rotulo: "Conta (opcional)", tipo: "select", opcoes: seletorConta(ctx, "", false) },
      { nome: "oculto", rotulo: "Ocultar do cliente", tipo: "check" },
    ],
    valores: tarefa || { frequencia: freqPadrao },
    confirmar: tarefa ? "Salvar" : "Adicionar",
  });
  if (!v) return;
  const dados = { titulo: v.titulo, frequencia: v.frequencia, categoria: v.categoria, contaId: v.contaId || null, oculto: v.oculto };
  const lista = tarefa
    ? ctx.dados.tarefas.map((t) => (t.id === tarefa.id ? { ...t, ...dados } : t))
    : [...ctx.dados.tarefas, { ...dados, ativo: true, ordem: ctx.dados.tarefas.length }];
  await ctx.acoes.salvarLista("tarefas", lista);
}

async function removerTarefa(ctx, tarefa) {
  if (!(await confirmar("Remover tarefa", `Remover "${tarefa.titulo}"? O histórico de marcações dela também deixa de aparecer.`, "Remover"))) return;
  await ctx.acoes.salvarLista("tarefas", ctx.dados.tarefas.filter((t) => t.id !== tarefa.id));
}

// ====================================================================== METAS

export function secaoMetas(ctx) {
  const admin = ehAdmin(ctx);
  const raiz = el("div");
  raiz.append(el("div", { class: "g-secao-titulo" }, el("h2", { text: "Metas por conta" }),
    admin ? botao("Nova meta", { iconeNome: "mais", classe: "g-primario", onClick: () => editarMeta(ctx, null) }) : null));
  if (!ctx.dados.metas.length) { raiz.append(vazio(admin ? "Cadastre as metas de cada conta (TACOS, faturamento, CPC, ticket médio...). Elas aparecem com barra de progresso e semáforo." : "Ainda não há metas cadastradas.")); return raiz; }

  const grupos = new Map();
  for (const m of ctx.dados.metas) {
    const k = m.contaId && nomeConta(ctx, m.contaId) ? m.contaId : "";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(m);
  }
  for (const [contaId, metas] of grupos) {
    const conta = ctx.dados.contas.find((c) => c.id === contaId);
    raiz.append(el("h3", { estilo: { margin: "18px 0 10px" } }, conta ? conta.nome + " " : "Geral (todas as contas) ", conta ? chipMarketplace(conta.marketplace) : null));
    const grade = el("div", { class: "g-grid g-c2" });
    for (const m of metas) {
      const dias = m.contaId ? diasDaConta(ctx, m.contaId) : diasGeral(ctx);
      const atual = valorAtualDaMeta(m, dias, ctx.hoje);
      const st = statusMeta(m, atual);
      grade.append(el("div", { class: "g-meta" + (admin && m.oculto ? " g-oculto-marca" : "") },
        el("div", { class: "g-meta-topo" },
          el("div", {}, el("strong", { text: m.rotulo }), el("div", { class: "g-sub", text: ROTULO_PERIODO[m.periodo] + " · " + (m.sentido === "max" ? "ficar abaixo de" : "chegar a") + " " + formatarMetrica(m.metrica, m.alvo) })),
          el("div", { class: "g-linha" }, chip(ROTULO_ESTADO[st.estado], "g-" + (st.estado === "sem_dado" ? "neutro" : st.estado)),
            admin ? botaoOlho(m.oculto, () => ctx.acoes.salvarLista("metas", ctx.dados.metas.map((x) => (x.id === m.id ? { ...x, oculto: !x.oculto } : x)))) : null,
            admin ? botao("", { iconeNome: "lapis", classe: "g-mini g-fantasma", titulo: "Editar meta", onClick: () => editarMeta(ctx, m) }) : null,
            admin ? botao("", { iconeNome: "lixo", classe: "g-mini g-fantasma", titulo: "Remover meta", onClick: () => removerMeta(ctx, m) }) : null)),
        barra(Math.min(st.progresso, 1), st.estado === "sem_dado" ? "" : st.estado),
        el("div", { class: "g-meta-nums" }, el("span", {}, "Agora: ", el("strong", { text: formatarMetrica(m.metrica, atual) })), el("span", {}, "Meta: ", el("strong", { text: formatarMetrica(m.metrica, m.alvo) }))),
        m.observacao ? el("div", { class: "g-sub", text: m.observacao }) : null));
    }
    raiz.append(grade);
  }
  return raiz;
}

const ROTULO_PERIODO = { dia: "Por dia", semana: "Na semana", mes: "No mês" };

async function editarMeta(ctx, meta) {
  const v = await formulario({
    titulo: meta ? "Editar meta" : "Nova meta",
    campos: [
      { nome: "contaId", rotulo: "Conta", tipo: "select", opcoes: seletorConta(ctx, meta?.contaId || "") },
      { nome: "metrica", rotulo: "Indicador", tipo: "select", opcoes: Object.entries(METRICAS).map(([k, i]) => [k, i.rotulo + (i.unidade ? ` (${i.unidade})` : "")]) },
      { nome: "rotulo", rotulo: "Nome da meta (opcional)", max: 60 },
      { nome: "periodo", rotulo: "Período de apuração", tipo: "select", opcoes: [["mes", "No mês"], ["semana", "Na semana"], ["dia", "Por dia"]] },
      { nome: "alvo", rotulo: "Valor da meta", tipo: "numero", obrigatorio: true, dica: "TACOS e ACoS em %, valores em reais, ROAS em x (ex.: 8)" },
      { nome: "sentido", rotulo: "Como medir (só para meta livre)", tipo: "select", opcoes: [["max", "Quanto menor, melhor"], ["min", "Quanto maior, melhor"]], dica: "TACOS, CPC e gasto já são “quanto menor, melhor”; faturamento e ROAS, “quanto maior”." },
      { nome: "atualManual", rotulo: "Valor atual (só para meta livre)", tipo: "numero", dica: "Indicadores automáticos usam os lançamentos de Ads." },
      { nome: "observacao", rotulo: "Observação", max: 300 },
      { nome: "oculto", rotulo: "Ocultar do cliente", tipo: "check" },
    ],
    valores: meta ? { ...meta, contaId: meta.contaId || "" } : { periodo: "mes", metrica: "tacos", sentido: "max", contaId: ctx.dados.contas[0]?.id || "" },
    confirmar: meta ? "Salvar" : "Adicionar",
  });
  if (!v) return;
  const dados = { ...v, contaId: v.contaId || null, rotulo: v.rotulo || METRICAS[v.metrica].rotulo, sentido: v.metrica === "custom" ? v.sentido : METRICAS[v.metrica].sentido };
  const lista = meta ? ctx.dados.metas.map((m) => (m.id === meta.id ? { ...m, ...dados } : m)) : [...ctx.dados.metas, dados];
  await ctx.acoes.salvarLista("metas", lista);
}

async function removerMeta(ctx, meta) {
  if (!(await confirmar("Remover meta", `Remover a meta "${meta.rotulo}"?`, "Remover"))) return;
  await ctx.acoes.salvarLista("metas", ctx.dados.metas.filter((m) => m.id !== meta.id));
}

// ====================================================================== PRIORIDADES

export const STATUS_PRIORIDADE_ROTULO = { nova: "Nova", em_andamento: "Em andamento", feita: "Feita", adiada: "Adiada" };
const URGENCIA_ROTULO = { alta: "Alta", media: "Média", baixa: "Baixa" };
const PESO = { alta: 0, media: 1, baixa: 2 };

export function secaoPrioridades(ctx) {
  const admin = ehAdmin(ctx);
  const raiz = el("div");
  raiz.append(el("div", { class: "g-secao-titulo" }, el("div", {}, el("h2", { text: admin ? "O que o cliente quer priorizar" : "Minhas prioridades" }),
    el("div", { class: "g-sub", text: admin ? "Tudo que o cliente cadastra no link dele aparece aqui. Você define o status e responde." : "Diga o que é mais importante para você agora. Eu acompanho e respondo aqui." })),
    botao("Nova prioridade", { iconeNome: "mais", classe: "g-primario", onClick: () => editarPrioridade(ctx, null) })));

  const itens = [...ctx.dados.prioridades].sort((a, b) => (a.status === "feita") - (b.status === "feita") || PESO[a.urgencia] - PESO[b.urgencia] || (a.ordem ?? 0) - (b.ordem ?? 0));
  if (!itens.length) { raiz.append(vazio(admin ? "O cliente ainda não cadastrou prioridades. Você também pode cadastrar." : "Nenhuma prioridade ainda. Clique em “Nova prioridade” para começar.")); return raiz; }

  for (const p of itens) {
    const podeEditar = admin || p.origem === "cliente";
    raiz.append(el("div", { class: `g-prio g-u-${p.urgencia} g-s-${p.status}` },
      el("div", { class: "g-linha g-entre" },
        el("div", { class: "g-linha" }, el("strong", { text: p.titulo }), p.origem === "cliente" ? chip(admin ? "do cliente" : "minha", "g-amarelo") : null),
        el("div", { class: "g-linha" },
          chip("Urgência " + URGENCIA_ROTULO[p.urgencia].toLowerCase(), p.urgencia === "alta" ? "g-fora" : p.urgencia === "baixa" ? "g-neutro" : "g-atencao"),
          chip(STATUS_PRIORIDADE_ROTULO[p.status], p.status === "feita" ? "g-ok" : p.status === "nova" ? "g-amarelo" : ""),
          podeEditar ? botao("", { iconeNome: "lapis", classe: "g-mini g-fantasma", titulo: "Editar", onClick: () => editarPrioridade(ctx, p) }) : null,
          podeEditar ? botao("", { iconeNome: "lixo", classe: "g-mini g-fantasma", titulo: "Remover", onClick: () => removerPrioridade(ctx, p) }) : null)),
      p.detalhe ? el("div", { class: "g-texto-quebra", text: p.detalhe }) : null,
      p.contaId && nomeConta(ctx, p.contaId) ? el("div", {}, chip(nomeConta(ctx, p.contaId), "g-amarelo")) : null,
      p.respostaAnalista ? el("div", { class: "g-resposta g-texto-quebra" }, el("b", { text: admin ? "Sua resposta: " : "Resposta do seu analista: " }), p.respostaAnalista) : null));
  }
  return raiz;
}

async function editarPrioridade(ctx, p) {
  const admin = ehAdmin(ctx);
  const campos = [
    { nome: "titulo", rotulo: "O que é prioridade", obrigatorio: true, max: 140 },
    { nome: "detalhe", rotulo: "Detalhes", tipo: "area", max: 1000, dica: "Conte o contexto: produto, prazo, o que você espera." },
    { nome: "contaId", rotulo: "Conta (opcional)", tipo: "select", opcoes: seletorConta(ctx, "", false) },
    { nome: "urgencia", rotulo: "Urgência", tipo: "select", opcoes: [["alta", "Alta"], ["media", "Média"], ["baixa", "Baixa"]] },
  ];
  if (admin) {
    campos.push({ nome: "status", rotulo: "Status", tipo: "select", opcoes: Object.entries(STATUS_PRIORIDADE_ROTULO) });
    campos.push({ nome: "respostaAnalista", rotulo: "Sua resposta ao cliente", tipo: "area", max: 500 });
  }
  const v = await formulario({ titulo: p ? "Editar prioridade" : "Nova prioridade", campos, valores: p ? { ...p, contaId: p.contaId || "" } : { urgencia: "media" }, confirmar: p ? "Salvar" : "Adicionar" });
  if (!v) return;
  const dados = { ...v, contaId: v.contaId || null };
  const base = ctx.dados.prioridades;
  const lista = p ? base.map((x) => (x.id === p.id ? { ...x, ...dados } : x)) : [...base, { ...dados, ordem: base.length, origem: admin ? "analista" : "cliente" }];
  await ctx.acoes.salvarPrioridades(lista);
}

async function removerPrioridade(ctx, p) {
  if (!(await confirmar("Remover prioridade", `Remover "${p.titulo}"?`, "Remover"))) return;
  await ctx.acoes.salvarPrioridades(ctx.dados.prioridades.filter((x) => x.id !== p.id));
}
