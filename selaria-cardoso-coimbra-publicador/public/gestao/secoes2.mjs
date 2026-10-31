// Telas compartilhadas, parte 2: Ads & TACOS, Diário, Full, Datas, Recados e Relatório.
import {
  FREQUENCIAS, ROTULO_FREQ, addDias, addMeses, agrupar, chavePeriodo, chaveRegistro, corContraMeta, datasSugeridas, diaDaSemana,
  diasDoMes, formatarDia, formatarDiaCurto, formatarMetrica, mesDe, moeda, nomeMes, numero, parsearPlanilha, percentual,
  recortar, resumir, statusMeta, ultimoDiaDoMes, valorAtualDaMeta,
} from "./calc.mjs";
import {
  MARKETPLACE_ROTULO, ROTULO_ESTADO, aviso, botao, chip, chipMarketplace, confirmar, el, formulario, graficoLinha, icone, kpi, limpar, ponto, vazio,
} from "./ui.mjs";
import { contasComAds, diasDaConta, diasGeral, metaTacosDe, nomeConta, STATUS_PRIORIDADE_ROTULO } from "./secoes.mjs";

const ehAdmin = (ctx) => ctx.modo === "admin";
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function botaoOlho(oculto, aoAlternar) {
  return botao("", { iconeNome: oculto ? "olhoFechado" : "olho", classe: "g-mini g-fantasma", titulo: oculto ? "Oculto para o cliente (clique para mostrar)" : "Visível para o cliente (clique para ocultar)", onClick: aoAlternar });
}

function navMes(ctx, ui, chave = "mes") {
  return el("div", { class: "g-nav-periodo" },
    botao("", { iconeNome: "esq", classe: "g-mini", titulo: "Mês anterior", onClick: () => { ui[chave] = addMeses(ui[chave], -1); ctx.rerender(); } }),
    el("span", { class: "g-periodo-rotulo", text: nomeMes(ui[chave]) }),
    botao("", { iconeNome: "dir", classe: "g-mini", titulo: "Próximo mês", onClick: () => { ui[chave] = addMeses(ui[chave], 1); ctx.rerender(); } }));
}

// ====================================================================== ADS & TACOS

const AGRUP = [["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"]];

function mesesNecessarios(ctx, ui) {
  const atual = mesDe(ctx.hoje);
  if (ui.agrup === "dia") return [ui.mes];
  const quantos = ui.agrup === "semana" ? 4 : ehAdmin(ctx) ? 12 : 3;
  return Array.from({ length: quantos }, (_, i) => addMeses(atual, -i));
}

export function secaoAds(ctx) {
  const admin = ehAdmin(ctx);
  const contas = contasComAds(ctx);
  const raiz = el("div");
  if (!contas.length) {
    raiz.append(el("div", { class: "g-secao-titulo" }, el("h2", { text: "Ads & TACOS" })), vazio(admin ? "Cadastre ao menos uma conta de marketplace para este cliente (botão “Editar cliente”)." : "Os resultados de Ads ainda não foram liberados."));
    return raiz;
  }
  const ui = (ctx.ui.ads ||= { contaId: contas[0].id, agrup: "dia", mes: mesDe(ctx.hoje) });
  if (!contas.some((c) => c.id === ui.contaId)) ui.contaId = contas[0].id;
  const conta = contas.find((c) => c.id === ui.contaId);

  const topo = el("div", { class: "g-secao-titulo" }, el("h2", { text: "Ads & TACOS" }),
    admin ? el("div", { class: "g-linha" },
      botao("Lançar dia", { iconeNome: "mais", classe: "g-primario", onClick: () => editarLancamento(ctx, conta, null) }),
      conta.marketplace === "ml" ? botao("Importar do Mercado Livre", { iconeNome: "baixar", classe: "g-amarelo", onClick: () => dialogoImportar(ctx, conta) }) : null,
      botao("Colar da planilha", { onClick: () => dialogoColar(ctx, conta) })) : null);
  raiz.append(topo);

  const seletor = el("select", { class: "g-select", "aria-label": "Conta", estilo: { width: "auto", "min-width": "220px" }, onchange: (ev) => { ui.contaId = ev.target.value; ctx.rerender(); } },
    contas.map((c) => el("option", { value: c.id, text: `${c.nome} · ${MARKETPLACE_ROTULO[c.marketplace]}`, selected: c.id === ui.contaId })));
  const segmentos = el("div", { class: "g-segmentos", role: "group", "aria-label": "Agrupar por" },
    AGRUP.map(([v, r]) => el("button", { type: "button", class: "g-segmento", "aria-pressed": String(ui.agrup === v), onclick: () => { ui.agrup = v; ctx.rerender(); } }, r)));
  raiz.append(el("div", { class: "g-linha g-entre", estilo: { "margin-bottom": "14px" } },
    el("div", { class: "g-linha" }, seletor, segmentos, ui.agrup === "dia" ? navMes(ctx, ui) : null),
    admin ? el("label", { class: "g-check-linha g-nao-imprimir" },
      el("input", { type: "checkbox", checked: !conta.ocultoAds, onchange: (ev) => ctx.acoes.salvarConta(conta.id, { ocultoAds: !ev.target.checked }) }), "Mostrar esta conta ao cliente") : null));

  const corpo = el("div", {}, el("div", { class: "g-sub", text: "Carregando lançamentos..." }));
  raiz.append(corpo);

  const meses = mesesNecessarios(ctx, ui);
  Promise.resolve(ctx.acoes.carregarAds ? ctx.acoes.carregarAds(conta.id, meses) : null)
    .then(() => preencherAds(ctx, ui, conta, corpo))
    .catch((e) => { limpar(corpo).append(el("div", { class: "g-erro-msg", text: e.message })); });
  return raiz;
}

function contagemPeriodos(n, agrup) {
  if (agrup === "dia") return n === 1 ? "1 dia com lançamento" : `${n} dias com lançamento`;
  if (agrup === "semana") return n === 1 ? "1 semana" : `${n} semanas`;
  return n === 1 ? "1 mês" : `${n} meses`;
}

function linhasDoPeriodo(ctx, ui, dias) {
  if (ui.agrup === "dia") {
    const todos = diasDoMes(ui.mes).filter((d) => d <= ctx.hoje).reverse();
    return todos
      .map((d) => (dias[d] ? { chave: d, rotulo: formatarDia(d).slice(0, 5) + " " + SEMANA[diaDaSemana(d)], inicio: d, ...resumir([dias[d]]), tacosMl: dias[d].tacosMl, fonte: dias[d].fonte, existe: true } : { chave: d, rotulo: formatarDia(d).slice(0, 5) + " " + SEMANA[diaDaSemana(d)], inicio: d, existe: false }))
      .filter((l) => l.existe || ehAdmin(ctx));
  }
  const linhas = agrupar(dias, ui.agrup).map((l) => ({ ...l, existe: true }));
  return linhas.slice(0, ui.agrup === "semana" ? 12 : 12);
}

function preencherAds(ctx, ui, conta, corpo) {
  const admin = ehAdmin(ctx);
  limpar(corpo);
  const dias = diasDaConta(ctx, conta.id);
  const linhas = linhasDoPeriodo(ctx, ui, dias);
  const comDados = linhas.filter((l) => l.existe);
  const meta = metaTacosDe(ctx, conta.id, ui.agrup === "dia" ? "dia" : ui.agrup === "semana" ? "semana" : "mes");

  if (!comDados.length) {
    corpo.append(vazio(admin ? "Ainda não há lançamentos neste período. Use “Lançar dia”, “Importar do Mercado Livre” ou “Colar da planilha”." : "Ainda não há resultados lançados neste período."));
    if (!admin) return;
  }
  const tot = resumir(comDados);
  const cor = (v) => corContraMeta(v, meta ? meta.alvo : null);

  corpo.append(el("div", { class: "g-kpis", estilo: { "margin-bottom": "14px" } },
    kpi("TACOS", percentual(tot.tacos), { cor: cor(tot.tacos), nota: meta ? `Meta ${percentual(meta.alvo)}` : "Gasto ÷ faturamento total", destaque: true }),
    kpi("Gasto com Ads", moeda(tot.gasto), { nota: contagemPeriodos(comDados.length, ui.agrup) }),
    kpi("Faturamento total", moeda(tot.fatTotal), { nota: "Ads + orgânico" }),
    kpi("ACoS", percentual(tot.acos), { nota: "Gasto ÷ faturamento de Ads" }),
    kpi("ROAS", tot.roas == null ? "—" : numero(tot.roas, 2) + "x", { nota: "Faturamento de Ads ÷ gasto" }),
    kpi("CPC médio", moeda(tot.cpc), { nota: tot.cliques ? `${numero(tot.cliques)} cliques` : "—" })));

  if (comDados.length >= 2) {
    const cron = [...comDados].reverse().map((l) => ({ rotulo: ui.agrup === "dia" ? l.rotulo.slice(0, 5) : ui.agrup === "semana" ? formatarDiaCurto(l.inicio) : l.rotulo, valor: l.tacos }));
    corpo.append(el("div", { class: "g-card", estilo: { "margin-bottom": "14px" } }, el("h3", { text: "TACOS por " + (ui.agrup === "dia" ? "dia" : ui.agrup === "semana" ? "semana" : "mês") }), el("div", { class: "g-grafico-wrap" }, graficoLinha(cron, { meta: meta ? meta.alvo : null })),
      el("div", { class: "g-legenda" }, el("span", {}, el("i", { estilo: { background: "var(--g-azul)" } }), "TACOS"), meta ? el("span", {}, el("i", { estilo: { background: "#E5493D" } }), "Meta") : null)));
  }

  const cabecalho = ["Período", "Gasto Ads", "Fat. total", "Fat. Ads", "TACOS", "ACoS", "ROAS", "CPC", "Pedidos", "Conv."];
  const tabela = el("table", { class: "g-tabela" },
    el("thead", {}, el("tr", {}, cabecalho.map((c) => el("th", { text: c })), admin && ui.agrup === "dia" ? el("th", { class: "g-nao-imprimir", text: "" }) : null)),
    el("tbody", {}, linhas.map((l) => {
      if (!l.existe) {
        return el("tr", { class: "g-clicavel", onclick: () => editarLancamento(ctx, conta, l.chave) },
          el("td", { text: l.rotulo }), el("td", { class: "g-fraco", colspan: cabecalho.length - 1, text: "sem lançamento — clique para lançar" }), el("td"));
      }
      const tr = el("tr", { class: admin && ui.agrup === "dia" ? "g-clicavel" : "" , onclick: admin && ui.agrup === "dia" ? () => editarLancamento(ctx, conta, l.chave) : null },
        el("td", {}, l.rotulo, l.fonte === "ml" ? el("span", { class: "g-sub", title: "Importado do Mercado Livre", text: " ·ML" }) : null),
        el("td", { text: moeda(l.gasto) }), el("td", { text: moeda(l.fatTotal) }), el("td", { text: moeda(l.fatAds) }),
        el("td", { class: "g-cor-" + cor(l.tacos), title: l.tacosMl != null ? `TACOS informado pelo Mercado Livre: ${percentual(l.tacosMl)}` : null }, el("strong", { text: percentual(l.tacos) })),
        el("td", { text: percentual(l.acos) }), el("td", { text: l.roas == null ? "—" : numero(l.roas, 2) + "x" }), el("td", { text: moeda(l.cpc) }),
        el("td", { text: numero(l.pedidos) }), el("td", { text: percentual(l.conversao) }));
      if (admin && ui.agrup === "dia") {
        tr.append(el("td", { class: "g-nao-imprimir" }, botao("", { iconeNome: "lixo", classe: "g-mini g-fantasma", titulo: "Apagar este dia", onClick: (ev) => { ev.stopPropagation(); apagarDia(ctx, conta, l.chave); } })));
      }
      return tr;
    })),
    comDados.length > 1 ? el("tfoot", {}, el("tr", {}, el("td", { text: "Total do período" }), el("td", { text: moeda(tot.gasto) }), el("td", { text: moeda(tot.fatTotal) }), el("td", { text: moeda(tot.fatAds) }),
      el("td", { class: "g-cor-" + cor(tot.tacos), text: percentual(tot.tacos) }), el("td", { text: percentual(tot.acos) }), el("td", { text: tot.roas == null ? "—" : numero(tot.roas, 2) + "x" }), el("td", { text: moeda(tot.cpc) }), el("td", { text: numero(tot.pedidos) }), el("td", { text: percentual(tot.conversao) }), admin && ui.agrup === "dia" ? el("td") : null)) : null);
  corpo.append(el("div", { class: "g-tabela-wrap" }, tabela));
  corpo.append(el("p", { class: "g-sub", estilo: { "margin-top": "10px" }, text: "Semana e mês somam os valores do período e recalculam os percentuais (não é média de percentuais). Semana vai de segunda a domingo." }));
}

async function editarLancamento(ctx, conta, dia) {
  const atual = dia ? diasDaConta(ctx, conta.id)[dia] : null;
  const v = await formulario({
    titulo: `${atual ? "Editar" : "Lançar"} dia — ${conta.nome}`,
    campos: [
      { nome: "data", rotulo: "Data", tipo: "data", obrigatorio: true },
      { nome: "gasto", rotulo: "Gasto com Ads (R$)", tipo: "numero", obrigatorio: true },
      { nome: "fatTotal", rotulo: "Faturamento total do dia (R$)", tipo: "numero", obrigatorio: true, dica: "Tudo que a conta vendeu: Ads + orgânico. É a base do TACOS." },
      { nome: "fatAds", rotulo: "Faturamento vindo de Ads (R$)", tipo: "numero", dica: "Base do ACoS e do ROAS." },
      { nome: "pedidos", rotulo: "Pedidos / unidades vendidas", tipo: "numero" },
      { nome: "pedidosAds", rotulo: "Pedidos vindos de Ads", tipo: "numero" },
      { nome: "cliques", rotulo: "Cliques", tipo: "numero" },
      { nome: "impressoes", rotulo: "Impressões", tipo: "numero" },
    ],
    valores: atual ? { ...atual, data: dia } : { data: dia || ctx.hoje },
    confirmar: "Salvar",
  });
  if (!v) return;
  const { data, ...resto } = v;
  if (await ctx.acoes.lancarAds(conta.id, { [data]: resto })) aviso("Dia salvo.", "bom");
}

async function apagarDia(ctx, conta, dia) {
  if (!(await confirmar("Apagar lançamento", `Apagar o lançamento de ${formatarDia(dia)} (${conta.nome})?`, "Apagar"))) return;
  await ctx.acoes.lancarAds(conta.id, { [dia]: null });
}

async function dialogoImportar(ctx, conta) {
  const ontem = addDias(ctx.hoje, -1);
  const v = await formulario({
    titulo: "Importar Ads do Mercado Livre",
    textoIntro: `Vou buscar o resumo diário de Product Ads da conta do Mercado Livre que está conectada na Central e gravar em “${conta.nome}”. Dias já lançados no período serão substituídos pelos dados do Mercado Livre.`,
    campos: [
      { nome: "de", rotulo: "De", tipo: "data", obrigatorio: true },
      { nome: "ate", rotulo: "Até", tipo: "data", obrigatorio: true, dica: "O Mercado Livre guarda cerca de 90 dias. Máximo de 62 dias por importação. Hoje ainda está parcial." },
    ],
    valores: { de: addDias(ontem, -6), ate: ontem },
    confirmar: "Importar",
  });
  if (!v) return;
  await ctx.acoes.importarMl(conta, v.de, v.ate);
}

async function dialogoColar(ctx, conta) {
  const v = await formulario({
    titulo: "Colar dados da planilha",
    textoIntro: "Cole linhas copiadas do Excel/Sheets ou do relatório da Shopee, nesta ordem: data, gasto, faturamento total, faturamento de ads, pedidos, cliques, impressões. Aceita data DD/MM/AAAA e números com vírgula.",
    campos: [{ nome: "texto", rotulo: "Linhas", tipo: "area", max: 60000, obrigatorio: true, placeholder: "30/10/2026\t12,50\t1000,00\t300,00\t8\t90\t4000" }],
    confirmar: "Conferir e importar",
  });
  if (!v) return;
  const { dias, erros } = parsearPlanilha(v.texto);
  const n = Object.keys(dias).length;
  if (!n) { aviso(erros.length ? `Nenhuma linha válida. ${erros[0].motivo} (linha ${erros[0].linha}).` : "Nenhuma linha reconhecida.", "erro"); return; }
  const ok = await confirmar("Confirmar importação", `${n} dia(s) reconhecido(s) em “${conta.nome}”.` + (erros.length ? ` ${erros.length} linha(s) ignorada(s) por erro (ex.: linha ${erros[0].linha}: ${erros[0].motivo}).` : "") + " Dias que já existirem serão substituídos.", "Importar", false);
  if (!ok) return;
  if (await ctx.acoes.lancarAds(conta.id, dias)) aviso(`${n} dia(s) importado(s).`, "bom");
}

// ====================================================================== DIÁRIO

export function secaoDiario(ctx) {
  const admin = ehAdmin(ctx);
  const ui = (ctx.ui.diario ||= { mes: mesDe(ctx.hoje) });
  const raiz = el("div");
  raiz.append(el("div", { class: "g-secao-titulo" }, el("div", {}, el("h2", { text: "Diário de ações" }), el("div", { class: "g-sub", text: "Tudo que foi feito pela conta, dia a dia." })), navMes(ctx, ui)));

  if (admin) {
    const data = el("input", { class: "g-input", type: "date", value: ctx.hoje, "aria-label": "Data", estilo: { width: "160px" } });
    const texto = el("input", { class: "g-input", type: "text", maxlength: 500, placeholder: "O que você fez? Ex.: Troquei as imagens dos 12 anúncios de perneira", "aria-label": "O que foi feito", estilo: { flex: "1", "min-width": "240px" } });
    const categoria = el("input", { class: "g-input", type: "text", maxlength: 40, placeholder: "Categoria", "aria-label": "Categoria", estilo: { width: "150px" } });
    const registrar = async () => {
      if (!texto.value.trim() || !data.value) { aviso("Escreva o que foi feito.", "erro"); return; }
      await ctx.acoes.salvarLista("diario", [...ctx.dados.diario, { data: data.value, texto: texto.value, categoria: categoria.value }]);
      aviso("Ação registrada.", "bom");
    };
    texto.addEventListener("keydown", (ev) => { if (ev.key === "Enter") registrar(); });
    raiz.append(el("div", { class: "g-card g-nao-imprimir", estilo: { "margin-bottom": "14px" } }, el("div", { class: "g-linha" }, data, texto, categoria, botao("Registrar", { classe: "g-primario", onClick: registrar }))));
  }

  const itens = ctx.dados.diario.filter((d) => mesDe(d.data) === ui.mes).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  if (!itens.length) { raiz.append(vazio("Nenhuma ação registrada em " + nomeMes(ui.mes) + ".")); return raiz; }
  for (const d of itens) {
    raiz.append(el("div", { class: "g-item" + (admin && d.oculto ? " g-oculto-marca" : "") },
      el("div", { class: "g-item-data", text: formatarDia(d.data).slice(0, 5) }),
      el("div", { class: "g-item-corpo" }, el("div", { class: "g-texto-quebra", text: d.texto }), el("div", { class: "g-linha", estilo: { "margin-top": "4px" } }, d.categoria ? chip(d.categoria) : null, d.contaId && nomeConta(ctx, d.contaId) ? chip(nomeConta(ctx, d.contaId), "g-amarelo") : null, admin && d.oculto ? chip("oculto do cliente", "g-neutro") : null)),
      admin ? el("div", { class: "g-linha g-nao-imprimir" },
        botaoOlho(d.oculto, () => ctx.acoes.salvarLista("diario", ctx.dados.diario.map((x) => (x.id === d.id ? { ...x, oculto: !x.oculto } : x)))),
        botao("", { iconeNome: "lapis", classe: "g-mini g-fantasma", titulo: "Editar", onClick: () => editarDiario(ctx, d) }),
        botao("", { iconeNome: "lixo", classe: "g-mini g-fantasma", titulo: "Apagar", onClick: async () => { if (await confirmar("Apagar ação", "Apagar este registro do diário?", "Apagar")) ctx.acoes.salvarLista("diario", ctx.dados.diario.filter((x) => x.id !== d.id)); } })) : null));
  }
  return raiz;
}

async function editarDiario(ctx, d) {
  const v = await formulario({
    titulo: "Editar ação",
    campos: [
      { nome: "data", rotulo: "Data", tipo: "data", obrigatorio: true },
      { nome: "texto", rotulo: "O que foi feito", tipo: "area", max: 500, obrigatorio: true },
      { nome: "categoria", rotulo: "Categoria", max: 40 },
      { nome: "contaId", rotulo: "Conta (opcional)", tipo: "select", opcoes: [["", "—"], ...ctx.dados.contas.map((c) => [c.id, c.nome])] },
    ],
    valores: { ...d, contaId: d.contaId || "" },
  });
  if (!v) return;
  await ctx.acoes.salvarLista("diario", ctx.dados.diario.map((x) => (x.id === d.id ? { ...x, ...v, contaId: v.contaId || null } : x)));
}

// ====================================================================== PRODUTOS NO FULL

export const STATUS_FULL = { analisando: "Analisando", aprovado: "Aprovado para o Full", montando: "Montando remessa", enviado: "Enviado", no_full: "No Full", descartado: "Descartado" };
const COR_FULL = { analisando: "g-neutro", aprovado: "g-amarelo", montando: "g-atencao", enviado: "", no_full: "g-ok", descartado: "g-fora" };

export function secaoFull(ctx) {
  const admin = ehAdmin(ctx);
  const raiz = el("div");
  raiz.append(el("div", { class: "g-secao-titulo" }, el("div", {}, el("h2", { text: "Produtos no Full" }), el("div", { class: "g-sub", text: "Análise, montagem e acompanhamento do que vai para o Mercado Envios Full." })),
    admin ? botao("Adicionar produto", { iconeNome: "mais", classe: "g-primario", onClick: () => editarFull(ctx, null) }) : null));
  const itens = ctx.dados.full;
  if (!itens.length) { raiz.append(vazio(admin ? "Liste aqui os produtos candidatos ao Full e acompanhe cada etapa." : "Ainda não há produtos do Full cadastrados.")); return raiz; }

  const contagem = {};
  for (const p of itens) contagem[p.status] = (contagem[p.status] || 0) + 1;
  raiz.append(el("div", { class: "g-linha", estilo: { "margin-bottom": "12px" } }, Object.entries(STATUS_FULL).filter(([k]) => contagem[k]).map(([k, r]) => chip(`${r}: ${contagem[k]}`, COR_FULL[k]))));

  const cab = ["SKU", "Produto", "Conta", "Etapa", "Estoque no Full", "Observação"];
  raiz.append(el("div", { class: "g-tabela-wrap" }, el("table", { class: "g-tabela" },
    el("thead", {}, el("tr", {}, cab.map((c) => el("th", { text: c })), admin ? el("th", { class: "g-nao-imprimir" }) : null)),
    el("tbody", {}, itens.map((p) => el("tr", { class: admin && p.oculto ? "g-oculto-marca" : "" },
      el("td", { text: p.sku || "—" }), el("td", { estilo: { "white-space": "normal", "min-width": "200px" }, text: p.produto }),
      el("td", { text: nomeConta(ctx, p.contaId) || "—" }), el("td", {}, chip(STATUS_FULL[p.status], COR_FULL[p.status])),
      el("td", { text: p.estoqueFull == null ? "—" : numero(p.estoqueFull) }), el("td", { estilo: { "white-space": "normal", "text-align": "left" }, text: p.observacao || "" }),
      admin ? el("td", { class: "g-nao-imprimir" }, el("div", { class: "g-linha", estilo: { "flex-wrap": "nowrap", "justify-content": "flex-end" } },
        botaoOlho(p.oculto, () => ctx.acoes.salvarLista("full", ctx.dados.full.map((x) => (x.id === p.id ? { ...x, oculto: !x.oculto } : x)))),
        botao("", { iconeNome: "lapis", classe: "g-mini g-fantasma", titulo: "Editar", onClick: () => editarFull(ctx, p) }),
        botao("", { iconeNome: "lixo", classe: "g-mini g-fantasma", titulo: "Remover", onClick: async () => { if (await confirmar("Remover produto", `Remover "${p.produto}" da lista do Full?`, "Remover")) ctx.acoes.salvarLista("full", ctx.dados.full.filter((x) => x.id !== p.id)); } }))) : null))))));
  return raiz;
}

async function editarFull(ctx, p) {
  const v = await formulario({
    titulo: p ? "Editar produto do Full" : "Adicionar produto ao Full",
    campos: [
      { nome: "produto", rotulo: "Produto", obrigatorio: true, max: 120 },
      { nome: "sku", rotulo: "SKU", max: 40 },
      { nome: "contaId", rotulo: "Conta", tipo: "select", opcoes: [["", "—"], ...ctx.dados.contas.filter((c) => c.marketplace === "ml").map((c) => [c.id, c.nome])] },
      { nome: "status", rotulo: "Etapa", tipo: "select", opcoes: Object.entries(STATUS_FULL) },
      { nome: "estoqueFull", rotulo: "Estoque no Full (un.)", tipo: "numero" },
      { nome: "observacao", rotulo: "Observação", max: 300, dica: "Ex.: giro, margem, dimensões, motivo de descartar" },
      { nome: "oculto", rotulo: "Ocultar do cliente", tipo: "check" },
    ],
    valores: p ? { ...p, contaId: p.contaId || "" } : { status: "analisando" },
  });
  if (!v) return;
  const dados = { ...v, contaId: v.contaId || null };
  await ctx.acoes.salvarLista("full", p ? ctx.dados.full.map((x) => (x.id === p.id ? { ...x, ...dados } : x)) : [...ctx.dados.full, dados]);
}

// ====================================================================== DATAS COMERCIAIS

export function secaoDatas(ctx) {
  const admin = ehAdmin(ctx);
  const raiz = el("div");
  raiz.append(el("div", { class: "g-secao-titulo" }, el("div", {}, el("h2", { text: "Datas comerciais" }), el("div", { class: "g-sub", text: "O que preparar antes de cada data importante." })),
    admin ? el("div", { class: "g-linha" }, botao("Sugerir datas do ano", { onClick: () => sugerirDatas(ctx) }), botao("Nova data", { iconeNome: "mais", classe: "g-primario", onClick: () => editarData(ctx, null) })) : null));
  const itens = [...ctx.dados.datas].sort((a, b) => (a.data < b.data ? -1 : 1));
  if (!itens.length) { raiz.append(vazio(admin ? "Use “Sugerir datas do ano” para começar com Dia das Mães, Black Friday, Natal e outras." : "Ainda não há datas cadastradas.")); return raiz; }
  for (const d of itens) {
    const falta = Math.round((Date.parse(d.data + "T00:00:00Z") - Date.parse(ctx.hoje + "T00:00:00Z")) / 86400000);
    const quando = falta === 0 ? "é hoje" : falta > 0 ? `em ${falta} dia(s)` : `passou há ${-falta} dia(s)`;
    raiz.append(el("div", { class: "g-item" + (falta < 0 || d.feito ? " g-oculto-marca" : "") },
      admin ? el("button", { type: "button", class: "g-check" + (d.feito ? " g-on" : ""), "aria-pressed": String(d.feito), "aria-label": `Marcar "${d.nome}" como preparada`, onclick: () => ctx.acoes.salvarLista("datas", ctx.dados.datas.map((x) => (x.id === d.id ? { ...x, feito: !x.feito } : x))) }, d.feito ? icone("ok", 16) : null) : null,
      el("div", { class: "g-item-data", text: formatarDia(d.data).slice(0, 5) }),
      el("div", { class: "g-item-corpo" }, el("div", { class: "g-linha" }, el("strong", { text: d.nome }), chip(quando, falta >= 0 && falta <= 15 ? "g-atencao" : "g-neutro"), d.feito ? chip("Preparada", "g-ok") : null, admin && d.oculto ? chip("oculta do cliente", "g-neutro") : null),
        d.preparacao ? el("div", { class: "g-texto-quebra g-sub", text: d.preparacao }) : null),
      admin ? el("div", { class: "g-linha g-nao-imprimir" },
        botaoOlho(d.oculto, () => ctx.acoes.salvarLista("datas", ctx.dados.datas.map((x) => (x.id === d.id ? { ...x, oculto: !x.oculto } : x)))),
        botao("", { iconeNome: "lapis", classe: "g-mini g-fantasma", titulo: "Editar", onClick: () => editarData(ctx, d) }),
        botao("", { iconeNome: "lixo", classe: "g-mini g-fantasma", titulo: "Remover", onClick: async () => { if (await confirmar("Remover data", `Remover "${d.nome}"?`, "Remover")) ctx.acoes.salvarLista("datas", ctx.dados.datas.filter((x) => x.id !== d.id)); } })) : null));
  }
  return raiz;
}

async function editarData(ctx, d) {
  const v = await formulario({
    titulo: d ? "Editar data" : "Nova data comercial",
    campos: [
      { nome: "nome", rotulo: "Nome", obrigatorio: true, max: 60 },
      { nome: "data", rotulo: "Data", tipo: "data", obrigatorio: true },
      { nome: "preparacao", rotulo: "O que preparar", tipo: "area", max: 500, dica: "Produtos prioritários, estoque, cupons, anúncios, Ads..." },
      { nome: "oculto", rotulo: "Ocultar do cliente", tipo: "check" },
    ],
    valores: d || {},
  });
  if (!v) return;
  await ctx.acoes.salvarLista("datas", d ? ctx.dados.datas.map((x) => (x.id === d.id ? { ...x, ...v } : x)) : [...ctx.dados.datas, v]);
}

async function sugerirDatas(ctx) {
  const ano = Number(ctx.hoje.slice(0, 4));
  const existentes = new Set(ctx.dados.datas.map((d) => d.nome + "|" + d.data));
  const novas = datasSugeridas(ano).filter((d) => d.data >= ctx.hoje && !existentes.has(d.nome + "|" + d.data));
  if (!novas.length) { aviso("As datas sugeridas deste ano já estão na lista.", ""); return; }
  await ctx.acoes.salvarLista("datas", [...ctx.dados.datas, ...novas]);
  aviso(`${novas.length} data(s) adicionada(s). Preencha “o que preparar” em cada uma.`, "bom");
}

// ====================================================================== RECADOS (e notas internas)

export function secaoRecados(ctx) {
  const admin = ehAdmin(ctx);
  const eu = admin ? "analista" : "cliente";
  const raiz = el("div");
  raiz.append(el("div", { class: "g-secao-titulo" }, el("div", {}, el("h2", { text: admin ? "Recados e notas" : "Recados" }), el("div", { class: "g-sub", text: admin ? "Conversa com o cliente e anotações internas (o cliente nunca vê as notas)." : "Deixe aqui pedidos e dúvidas. Eu respondo por aqui." }))));

  const chat = el("div", { class: "g-chat", role: "log", "aria-label": "Conversa" });
  if (!ctx.dados.recados.length) chat.append(el("div", { class: "g-sub", text: "Nenhuma mensagem ainda." }));
  for (const r of ctx.dados.recados) {
    chat.append(el("div", { class: "g-bolha" + (r.de === eu ? " g-meu" : "") }, el("div", { class: "g-texto-quebra", text: r.texto }),
      el("small", { text: (r.de === "cliente" ? "Cliente" : "Analista") + " · " + new Date(r.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) })));
  }
  const campo = el("textarea", { class: "g-area", maxlength: 2000, placeholder: admin ? "Responder ao cliente..." : "Escreva sua mensagem...", "aria-label": "Mensagem" });
  const enviar = botao("Enviar", { iconeNome: "dir", classe: "g-primario", onClick: async () => { const t = campo.value.trim(); if (!t) return; await ctx.acoes.enviarRecado(t); } });
  const caixaChat = el("div", { class: "g-card" }, chat, el("div", { estilo: { "margin-top": "12px" } }, campo, el("div", { class: "g-linha", estilo: { "margin-top": "8px", "justify-content": "flex-end" } }, enviar)));

  if (!admin) { raiz.append(caixaChat); queueMicrotask(() => { chat.scrollTop = chat.scrollHeight; }); return raiz; }

  const notas = el("textarea", { class: "g-area", maxlength: 8000, estilo: { "min-height": "260px" }, "aria-label": "Notas internas", value: ctx.dados.notas?.texto || "", placeholder: "Anotações só suas: acordos, senhas de contexto, o que o cliente aprova ou rejeita..." });
  const salvar = botao("Salvar notas", { classe: "g-primario", onClick: () => ctx.acoes.salvarNotas(notas.value) });
  raiz.append(el("div", { class: "g-grid g-c2" }, caixaChat,
    el("div", { class: "g-card" }, el("div", { class: "g-linha g-entre" }, el("h3", { text: "Notas internas" }), chip("só você vê", "g-amarelo")), notas, el("div", { class: "g-linha", estilo: { "margin-top": "8px", "justify-content": "flex-end" } }, salvar))));
  queueMicrotask(() => { chat.scrollTop = chat.scrollHeight; });
  return raiz;
}

// ====================================================================== RELATÓRIO MENSAL

function periodosDoMes(freq, mes, hoje) {
  const dias = diasDoMes(mes).filter((d) => d <= hoje);
  if (freq === "diaria") return dias.map((d) => chavePeriodo("diaria", d));
  if (freq === "semanal") return [...new Set(dias.map((d) => chavePeriodo("semanal", d)))];
  return dias.length ? [chavePeriodo("mensal", mes + "-01")] : [];
}

export function secaoRelatorio(ctx) {
  const admin = ehAdmin(ctx);
  const ui = (ctx.ui.relatorio ||= { mes: mesDe(ctx.hoje) });
  const raiz = el("div", { class: "g-relatorio" });
  raiz.append(el("div", { class: "g-secao-titulo g-nao-imprimir" }, el("h2", { text: "Relatório mensal" }), el("div", { class: "g-linha" }, navMes(ctx, ui), botao("Imprimir / salvar PDF", { iconeNome: "imprimir", classe: "g-primario", onClick: () => window.print() }))));

  const cabecalho = el("div", { class: "g-card" }, el("h2", { text: `Relatório de ${nomeMes(ui.mes)}` }), el("div", { class: "g-sub", text: `${ctx.dados.nomeCliente || ""} · gerado em ${formatarDia(ctx.hoje)}` }));
  raiz.append(cabecalho);
  const corpo = el("div", {}, el("div", { class: "g-sub", text: "Carregando..." }));
  raiz.append(corpo);

  const contas = contasComAds(ctx);
  const garantir = ctx.acoes.carregarAds ? Promise.all(contas.map((c) => ctx.acoes.carregarAds(c.id, [ui.mes]))) : Promise.resolve();
  const garantirRegistros = ctx.acoes.garantirRegistros ? ctx.acoes.garantirRegistros(ui.mes.slice(0, 4)) : Promise.resolve();
  Promise.all([garantir, garantirRegistros]).then(() => montarRelatorio(ctx, ui.mes, corpo)).catch((e) => limpar(corpo).append(el("div", { class: "g-erro-msg", text: e.message })));
  return raiz;
}

function montarRelatorio(ctx, mes, corpo) {
  limpar(corpo);
  const fim = ultimoDiaDoMes(mes);
  const ate = fim < ctx.hoje ? fim : ctx.hoje;
  const contas = contasComAds(ctx);

  // resultados
  for (const c of contas) {
    const dias = recortar(diasDaConta(ctx, c.id), mes + "-01", fim);
    const lista = Object.values(dias);
    const bloco = el("div", { class: "g-card" }, el("div", { class: "g-linha g-entre" }, el("h3", { text: `${c.nome}` }), chipMarketplace(c.marketplace)));
    if (!lista.length) { bloco.append(el("div", { class: "g-sub", text: "Sem lançamentos de Ads neste mês." })); corpo.append(bloco); continue; }
    const t = resumir(lista);
    const meta = metaTacosDe(ctx, c.id, "mes");
    bloco.append(el("div", { class: "g-grid g-c4", estilo: { margin: "10px 0" } },
      kpi("TACOS", percentual(t.tacos), { cor: corContraMeta(t.tacos, meta?.alvo ?? null), nota: meta ? `Meta ${percentual(meta.alvo)}` : null }), kpi("Gasto com Ads", moeda(t.gasto)), kpi("Faturamento total", moeda(t.fatTotal)), kpi("ROAS", t.roas == null ? "—" : numero(t.roas, 2) + "x")));
    const semanas = agrupar(dias, "semana").reverse();
    const cab = ["Semana", "Gasto Ads", "Fat. total", "TACOS", "ACoS", "ROAS", "CPC"];
    bloco.append(el("div", { class: "g-tabela-wrap" }, el("table", { class: "g-tabela" },
      el("thead", {}, el("tr", {}, cab.map((x) => el("th", { text: x })))),
      el("tbody", {}, semanas.map((s) => el("tr", {}, el("td", { text: s.rotulo }), el("td", { text: moeda(s.gasto) }), el("td", { text: moeda(s.fatTotal) }), el("td", { class: "g-cor-" + corContraMeta(s.tacos, meta?.alvo ?? null), text: percentual(s.tacos) }), el("td", { text: percentual(s.acos) }), el("td", { text: s.roas == null ? "—" : numero(s.roas, 2) + "x" }), el("td", { text: moeda(s.cpc) })))))));
    bloco.append(el("div", { class: "g-sub", estilo: { "margin-top": "6px" }, text: "Semanas que atravessam o mês mostram só os dias deste mês." }));
    corpo.append(bloco);
  }

  // metas do mês
  const metasMes = ctx.dados.metas.filter((m) => m.periodo === "mes");
  if (metasMes.length) {
    const bloco = el("div", { class: "g-card" }, el("h3", { text: "Metas do mês" }));
    for (const m of metasMes) {
      const dias = m.contaId ? diasDaConta(ctx, m.contaId) : diasGeral(ctx);
      const atual = valorAtualDaMeta(m, dias, ate);
      const st = statusMeta(m, atual);
      bloco.append(el("div", { class: "g-conta-linha", estilo: { padding: "5px 0" } }, ponto(st.estado), el("span", { class: "g-nome", text: `${m.rotulo}${m.contaId ? " · " + (nomeConta(ctx, m.contaId) || "") : ""}` }), el("strong", { text: `${formatarMetrica(m.metrica, atual)} de ${formatarMetrica(m.metrica, m.alvo)}` }), chip(ROTULO_ESTADO[st.estado], "g-" + (st.estado === "sem_dado" ? "neutro" : st.estado))));
    }
    corpo.append(bloco);
  }

  // tarefas
  const tarefas = ctx.dados.tarefas.filter((t) => t.ativo !== false);
  if (tarefas.length) {
    const bloco = el("div", { class: "g-card" }, el("h3", { text: "Tarefas do mês" }));
    const linhas = [];
    for (const f of FREQUENCIAS) {
      const periodos = periodosDoMes(f, mes, ctx.hoje);
      for (const t of tarefas.filter((x) => x.frequencia === f)) {
        let ok = 0; const falhas = [];
        for (const p of periodos) {
          const r = ctx.dados.registros[chaveRegistro(t.id, p)];
          if (r?.status === "ok") ok += 1;
          else if (r?.status === "nao_ok") falhas.push({ p, motivo: r.motivo });
        }
        linhas.push({ t, f, ok, total: periodos.length, falhas });
      }
    }
    bloco.append(el("div", { class: "g-tabela-wrap" }, el("table", { class: "g-tabela" },
      el("thead", {}, el("tr", {}, ["Tarefa", "Frequência", "Feitas", "Não OK (motivos)"].map((x) => el("th", { text: x })))),
      el("tbody", {}, linhas.map((l) => el("tr", {},
        el("td", { estilo: { "white-space": "normal" }, text: l.t.titulo }), el("td", { text: ROTULO_FREQ[l.f] }), el("td", { text: `${l.ok} de ${l.total}` }),
        el("td", { estilo: { "white-space": "normal", "text-align": "left" }, text: l.falhas.length ? l.falhas.slice(0, 4).map((x) => `${x.p.slice(2)}: ${x.motivo || "sem motivo informado"}`).join(" · ") + (l.falhas.length > 4 ? ` · +${l.falhas.length - 4}` : "") : "—" })))))));
    corpo.append(bloco);
  }

  // ações do mês
  const acoes = ctx.dados.diario.filter((d) => mesDe(d.data) === mes).sort((a, b) => (a.data < b.data ? -1 : 1));
  const blocoA = el("div", { class: "g-card" }, el("h3", { text: "O que foi feito" }));
  if (!acoes.length) blocoA.append(el("div", { class: "g-sub", text: "Nenhuma ação registrada no diário deste mês." }));
  for (const a of acoes) blocoA.append(el("div", { class: "g-conta-linha", estilo: { padding: "4px 0", "align-items": "flex-start" } }, el("strong", { text: formatarDia(a.data).slice(0, 5) }), el("span", { class: "g-texto-quebra", text: a.texto })));
  corpo.append(blocoA);

  const prios = ctx.dados.prioridades;
  if (prios.length) {
    const bloco = el("div", { class: "g-card" }, el("h3", { text: "Prioridades" }));
    for (const p of prios) bloco.append(el("div", { class: "g-conta-linha", estilo: { padding: "4px 0" } }, chip(STATUS_PRIORIDADE_ROTULO[p.status], p.status === "feita" ? "g-ok" : p.status === "nova" ? "g-amarelo" : ""), el("span", { class: "g-nome", text: p.titulo })));
    corpo.append(bloco);
  }
}
