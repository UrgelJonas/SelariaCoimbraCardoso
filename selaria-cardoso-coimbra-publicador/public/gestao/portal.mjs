// Portal do cliente: aberto por um link secreto (/c/<código>). Só mostra o que a Gestão libera para aquele cliente.
// O cliente pode editar as próprias prioridades e deixar recados; todo o resto é somente leitura.
import { hojeSP } from "./calc.mjs";
import { aviso, botao, criarApi, el, limpar, vazio } from "./ui.mjs";
import { secaoMetas, secaoPrioridades, secaoResumo, secaoTarefas } from "./secoes.mjs";
import { secaoAds, secaoDatas, secaoDiario, secaoFull, secaoRecados, secaoRelatorio } from "./secoes2.mjs";

const LOGO = "/assets/curva-a-logo.png";
const raiz = document.getElementById("app");

const ABAS = [
  { id: "resumo", rotulo: "Resumo", desenhar: secaoResumo },
  { id: "tarefas", rotulo: "Tarefas", desenhar: secaoTarefas },
  { id: "metas", rotulo: "Metas", desenhar: secaoMetas },
  { id: "prioridades", rotulo: "Minhas prioridades", desenhar: secaoPrioridades },
  { id: "ads", rotulo: "Ads & TACOS", desenhar: secaoAds, quando: (c) => c.dados.contas.some((x) => x.adsVisivel) },
  { id: "diario", rotulo: "O que foi feito", desenhar: secaoDiario },
  { id: "full", rotulo: "Full", desenhar: secaoFull, quando: (c) => c.dados.full.length > 0 },
  { id: "datas", rotulo: "Datas comerciais", desenhar: secaoDatas, quando: (c) => c.dados.datas.length > 0 },
  { id: "recados", rotulo: "Recados", desenhar: secaoRecados, contador: (c) => c.dados.recados.filter((r) => r.de === "analista" && !r.lido).length },
  { id: "relatorio", rotulo: "Relatório", desenhar: secaoRelatorio },
];

const token = location.pathname.split("/").filter(Boolean)[1] || "";
const tokenValido = /^[A-Za-z0-9_-]{43}$/.test(token);
const api = criarApi(tokenValido ? "/api/c/" + token : "/api/c/invalido");

let hoje = hojeSP();
const estado = { aba: "resumo", ui: {}, revPrioridades: 0, ctx: null, nome: "" };

function topo(titulo, sub) {
  return el("header", { class: "g-topbar" },
    el("img", { class: "g-logo", src: LOGO, alt: "Curva A", width: 40, height: 40 }),
    el("div", { class: "g-titulo" }, titulo, sub ? el("small", { text: sub }) : null),
    el("div", { class: "g-espaco" }));
}

function telaErro(msg) {
  limpar(raiz);
  raiz.className = "g-root g-app";
  raiz.append(topo("Curva A", "Acompanhamento de resultados"),
    el("main", { class: "g-main" }, el("div", { class: "g-login" },
      el("img", { class: "g-logo-grande", src: LOGO, alt: "Curva A", width: 84, height: 84 }),
      el("h1", { text: "Não foi possível abrir" }),
      el("div", { class: "g-card" }, el("p", { text: msg }), el("p", { class: "g-sub", text: "Se você acredita que isso é um engano, peça um novo link para quem cuida da sua conta." })))));
}

function desenhar() {
  const y = window.scrollY;
  limpar(raiz);
  raiz.className = "g-root g-app";
  const ctx = estado.ctx;
  const abas = ABAS.filter((a) => !a.quando || a.quando(ctx));
  if (!abas.some((a) => a.id === estado.aba)) estado.aba = "resumo";

  const barra = el("div", { class: "g-abas g-nao-imprimir", role: "tablist", "aria-label": "Seções" }, abas.map((a) => {
    const n = a.contador ? a.contador(ctx) : 0;
    return el("button", {
      type: "button", class: "g-aba", role: "tab", "aria-selected": String(estado.aba === a.id),
      onclick: () => { estado.aba = a.id; if (a.id === "recados") marcarLidos(); desenhar(); window.scrollTo(0, 0); },
    }, a.rotulo, n ? el("span", { class: "g-contador", text: String(n) }) : null);
  }));

  const area = el("div", { role: "tabpanel" });
  try {
    area.append(abas.find((a) => a.id === estado.aba).desenhar(ctx));
  } catch (e) {
    console.error("Portal:", e);
    area.append(el("div", { class: "g-erro-msg", text: "Não consegui montar esta tela. Tente atualizar a página." }));
  }

  raiz.append(
    el("header", { class: "g-topbar" },
      el("img", { class: "g-logo", src: LOGO, alt: "Curva A", width: 40, height: 40 }),
      el("div", { class: "g-titulo" }, estado.nome, el("small", { text: "Acompanhamento de resultados · Curva A" })),
      el("div", { class: "g-espaco" }),
      botao("Atualizar", { onClick: carregar })),
    el("main", { class: "g-main" }, barra, area,
      el("p", { class: "g-sub g-nao-imprimir", estilo: { "margin-top": "34px", "text-align": "center" }, text: "Curva A · gestão de marketplaces" })));
  window.scrollTo(0, y);
}

function marcarLidos() {
  const ctx = estado.ctx;
  if (!ctx.dados.recados.some((r) => r.de === "analista" && !r.lido)) return;
  ctx.dados.recados = ctx.dados.recados.map((r) => (r.de === "analista" ? { ...r, lido: true } : r));
  api("/recados", { metodo: "POST", corpo: { acao: "lidos" } }).catch(() => {});
}

function montar(d) {
  estado.nome = d.cliente.nome;
  estado.revPrioridades = d.revPrioridades || 0;
  const dados = {
    nomeCliente: d.cliente.nome, contas: d.contas, tarefas: d.tarefas, metas: d.metas, prioridades: d.prioridades, recados: d.recados,
    diario: d.diario, full: d.full, datas: d.datas, notas: { texto: "" }, registros: d.registros, ads: d.ads,
  };
  let fila = Promise.resolve();
  const enfileirar = (fn) => { const p = fila.then(fn); fila = p.catch(() => {}); return p; };

  estado.ctx = {
    modo: "cliente",
    get hoje() { return hoje; },
    get ui() { return estado.ui; },
    dados,
    rerender: desenhar,
    acoes: {
      salvarPrioridades(lista) {
        return enfileirar(async () => {
          try {
            const r = await api("/prioridades", { metodo: "PUT", corpo: { rev: estado.revPrioridades, dados: lista } });
            dados.prioridades = r.prioridades;
            estado.revPrioridades = r.rev;
            desenhar();
            return true;
          } catch (e) {
            if (e.status === 409) { aviso("Sua lista mudou em outra tela. Atualizei; refaça a alteração.", "erro"); await carregar(); } else aviso(e.message, "erro");
            return false;
          }
        });
      },
      enviarRecado(texto) {
        return enfileirar(async () => {
          try {
            const r = await api("/recados", { metodo: "POST", corpo: { texto } });
            dados.recados = [...dados.recados, r.recado];
            desenhar();
            return true;
          } catch (e) { aviso(e.message, "erro"); return false; }
        });
      },
    },
  };
}

async function carregar() {
  hoje = hojeSP();
  if (!tokenValido) return telaErro("Link inválido ou desativado.");
  try {
    const d = await api("?hoje=" + hoje);
    montar(d);
    if (estado.aba === "recados") marcarLidos();
    desenhar();
  } catch (e) {
    if (estado.ctx) aviso(e.message, "erro");
    else telaErro(e.status === 404 ? "Link inválido ou desativado." : e.message);
  }
}

limpar(raiz);
raiz.className = "g-root g-app";
raiz.append(topo("Curva A", "Acompanhamento de resultados"), el("main", { class: "g-main" }, vazio("Carregando...")));
carregar();
