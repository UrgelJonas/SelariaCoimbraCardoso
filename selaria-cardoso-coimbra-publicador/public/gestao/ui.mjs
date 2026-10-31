// Peças de interface compartilhadas pelo painel do dono e pelo portal do cliente.
//
// SEGURANÇA: nada aqui usa innerHTML com dados. Todo texto entra por textContent (via el()),
// então um recado ou título escrito por um cliente nunca vira HTML/script na tela do dono.
// Estilos dinâmicos usam element.style (permitido pela CSP do portal), nunca atributo style em texto.
import { corContraMeta, lerNumero, moeda, numero, percentual } from "./calc.mjs";

const NS_SVG = "http://www.w3.org/2000/svg";

export function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  aplicar(e, props);
  anexar(e, filhos);
  return e;
}

export function svg(tag, attrs = {}, ...filhos) {
  const e = document.createElementNS(NS_SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  for (const f of filhos.flat()) if (f) e.append(f);
  return e;
}

function aplicar(e, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k === "estilo") for (const [p, val] of Object.entries(v)) e.style.setProperty(p, val);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") e.value = v;
    else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected" || k === "required") e[k] = Boolean(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
}

function anexar(e, filhos) {
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
}

export function limpar(no) {
  no.replaceChildren();
  return no;
}

// ---------- ícones (caminhos fixos, sem dados) ----------
const ICONES = {
  ok: "M5 12.5l4.2 4.2L19 7",
  x: "M6 6l12 12M18 6L6 18",
  olho: "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z",
  olhoFechado: "M3 3l18 18M10.6 5.7A10 10 0 0112 5.5c6.4 0 10 6.5 10 6.5a17 17 0 01-3.3 4M6.5 7.2A17 17 0 002 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 004.2 4.2",
  lapis: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  lixo: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6",
  cima: "M6 15l6-6 6 6",
  baixo: "M6 9l6 6 6-6",
  esq: "M15 6l-6 6 6 6",
  dir: "M9 6l6 6-6 6",
  mais: "M12 5v14M5 12h14",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1",
  imprimir: "M7 9V4h10v5M7 17H5a2 2 0 01-2-2v-4a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2h-2M7 14h10v6H7z",
  baixar: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14",
};

export function icone(nome, tamanho = 16) {
  return svg("svg", { viewBox: "0 0 24 24", width: tamanho, height: tamanho, fill: "none", stroke: "currentColor", "stroke-width": 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    svg("path", { d: ICONES[nome] || "" }));
}

export function botao(rotulo, { iconeNome, classe = "", onClick, titulo, desabilitado } = {}) {
  const b = el("button", { type: "button", class: "g-btn " + classe, title: titulo, disabled: desabilitado, onclick: onClick });
  if (iconeNome) b.append(icone(iconeNome, 15));
  if (rotulo) b.append(document.createTextNode(rotulo));
  if (!rotulo && titulo) b.setAttribute("aria-label", titulo);
  return b;
}

export function chip(texto, classe = "") {
  return el("span", { class: "g-chip " + classe, text: texto });
}

export function ponto(estado) {
  return el("span", { class: "g-ponto g-" + (estado === "sem_dado" ? "neutro" : estado), "aria-hidden": "true" });
}

export const ROTULO_ESTADO = { ok: "No alvo", atencao: "Atenção", fora: "Fora do alvo", sem_dado: "Sem dados" };

export function kpi(rotulo, valor, { nota, cor = "neutro", destaque = false } = {}) {
  return el("div", { class: "g-kpi" + (destaque ? " g-destaque" : "") },
    el("div", { class: "g-kpi-rotulo", text: rotulo }),
    el("div", { class: "g-kpi-valor g-cor-" + cor, text: valor }),
    nota ? el("div", { class: "g-kpi-nota", text: nota }) : null);
}

export function barra(progresso, estado = "") {
  const dentro = el("span");
  dentro.style.width = Math.max(0, Math.min(100, Math.round(progresso * 100))) + "%";
  return el("div", { class: "g-barra" + (estado ? " g-" + estado : ""), role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(progresso * 100) }, dentro);
}

export function vazio(texto) {
  return el("div", { class: "g-vazio", text: texto });
}

// ---------- avisos ----------
let areaToasts = null;
export function aviso(texto, tipo = "") {
  if (!areaToasts || !areaToasts.isConnected) {
    areaToasts = el("div", { class: "g-root g-toasts", role: "status", "aria-live": "polite" });
    document.body.append(areaToasts);
  }
  const t = el("div", { class: "g-toast " + (tipo ? "g-" + tipo : ""), text: texto });
  areaToasts.append(t);
  setTimeout(() => t.remove(), tipo === "erro" ? 6500 : 3200);
}

// ---------- diálogo de formulário ----------
// campos: [{ nome, rotulo, tipo: texto|area|numero|data|select|check, opcoes: [[valor, rotulo]], obrigatorio, dica, valor }]
export function formulario({ titulo, campos, valores = {}, confirmar = "Salvar", perigo = false, extra, textoIntro }) {
  return new Promise((resolver) => {
    const dlg = el("dialog", { class: "g-root g-dialogo" });
    const corpo = el("div", { class: "g-corpo" });
    const caixaAviso = el("div", { class: "g-aviso-form", hidden: true });
    const entradas = new Map();
    if (textoIntro) corpo.append(el("p", { class: "g-sub", text: textoIntro }));
    corpo.append(caixaAviso);

    for (const c of campos) {
      const id = "g-f-" + c.nome + "-" + Math.random().toString(36).slice(2, 7);
      const atual = valores[c.nome] ?? c.valor ?? (c.tipo === "check" ? false : "");
      let entrada;
      if (c.tipo === "area") entrada = el("textarea", { class: "g-area", id, maxlength: c.max || 2000, value: atual });
      else if (c.tipo === "select") {
        entrada = el("select", { class: "g-select", id }, (c.opcoes || []).map(([v, r]) => el("option", { value: v, text: r, selected: String(v) === String(atual) })));
      } else if (c.tipo === "check") entrada = el("input", { type: "checkbox", id, checked: Boolean(atual) });
      else if (c.tipo === "data") entrada = el("input", { class: "g-input", type: "date", id, value: atual });
      else entrada = el("input", { class: "g-input", type: "text", id, value: atual, maxlength: c.max || 200, inputmode: c.tipo === "numero" ? "decimal" : null, autocomplete: "off", placeholder: c.placeholder });
      entradas.set(c.nome, { entrada, c });

      if (c.tipo === "check") {
        corpo.append(el("div", { class: "g-campo" }, el("label", { class: "g-check-linha", for: id }, entrada, c.rotulo), c.dica ? el("div", { class: "g-dica", text: c.dica }) : null));
      } else {
        corpo.append(el("div", { class: "g-campo" }, el("label", { for: id, text: c.rotulo + (c.obrigatorio ? " *" : "") }), entrada, c.dica ? el("div", { class: "g-dica", text: c.dica }) : null));
      }
    }
    if (extra) corpo.append(extra);

    const fechar = (v) => { dlg.close(); dlg.remove(); resolver(v); };
    const form = el("form", { method: "dialog", novalidate: true },
      el("header", {}, el("h3", { text: titulo })),
      corpo,
      el("footer", {},
        el("button", { type: "button", class: "g-btn", onclick: () => fechar(null) }, "Cancelar"),
        el("button", { type: "submit", class: "g-btn " + (perigo ? "g-perigo" : "g-primario") }, confirmar)));

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const saida = {};
      let primeiroErro = null;
      for (const [nome, { entrada, c }] of entradas) {
        let v;
        if (c.tipo === "check") v = entrada.checked;
        else if (c.tipo === "numero") {
          v = lerNumero(entrada.value);
          if (entrada.value.trim() && v == null) { entrada.classList.add("g-erro"); primeiroErro ||= `${c.rotulo}: número inválido.`; }
        } else v = entrada.value.trim();
        if (c.obrigatorio && (v === "" || v == null)) { entrada.classList.add("g-erro"); primeiroErro ||= `Preencha: ${c.rotulo}.`; }
        else if (c.tipo !== "check") entrada.classList.remove("g-erro");
        saida[nome] = v;
      }
      if (primeiroErro) { caixaAviso.textContent = primeiroErro; caixaAviso.hidden = false; return; }
      fechar(saida);
    });
    dlg.addEventListener("cancel", (ev) => { ev.preventDefault(); fechar(null); });
    dlg.append(form);
    document.body.append(dlg);
    dlg.showModal();
    const primeiro = corpo.querySelector("input:not([type=checkbox]),textarea,select");
    if (primeiro) primeiro.focus();
  });
}

export function confirmar(titulo, texto, rotulo = "Confirmar", perigo = true) {
  return formulario({ titulo, campos: [], textoIntro: texto, confirmar: rotulo, perigo }).then((r) => r !== null);
}

// ---------- gráfico de linha (TACOS por período) ----------
// pontos: [{ rotulo, valor }] em ordem cronológica. meta: número ou null.
export function graficoLinha(pontos, { meta = null, formato = (v) => percentual(v), largura = 720, altura = 220 } = {}) {
  const util = pontos.filter((p) => p.valor != null);
  if (util.length < 2) return vazio("Preciso de pelo menos 2 períodos com dados para desenhar o gráfico.");
  const m = { e: 46, d: 14, t: 14, b: 30 };
  const maxDados = Math.max(...util.map((p) => p.valor), meta ?? 0);
  const topo = maxDados > 0 ? maxDados * 1.15 : 1;
  const x = (i) => m.e + (pontos.length === 1 ? 0 : (i * (largura - m.e - m.d)) / (pontos.length - 1));
  const y = (v) => m.t + (1 - v / topo) * (altura - m.t - m.b);

  const s = svg("svg", { class: "g-grafico", viewBox: `0 0 ${largura} ${altura}`, role: "img", "aria-label": "Gráfico de evolução" });
  for (let i = 0; i <= 4; i++) {
    const v = (topo * i) / 4;
    s.append(svg("line", { class: "g-eixo", x1: m.e, x2: largura - m.d, y1: y(v), y2: y(v) }));
    const t = svg("text", { x: m.e - 6, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = formato(v);
    s.append(t);
  }
  if (meta != null) {
    s.append(svg("line", { class: "g-linha-meta", x1: m.e, x2: largura - m.d, y1: y(meta), y2: y(meta) }));
    const t = svg("text", { class: "g-rotulo-meta", x: largura - m.d, y: y(meta) - 5, "text-anchor": "end" });
    t.textContent = "meta " + formato(meta);
    s.append(t);
  }
  const caminho = [];
  pontos.forEach((p, i) => {
    if (p.valor == null) return;
    caminho.push((caminho.length ? "L" : "M") + x(i).toFixed(1) + " " + y(p.valor).toFixed(1));
  });
  s.append(svg("path", { class: "g-serie", d: caminho.join(" ") }));
  const passo = Math.ceil(pontos.length / 8);
  pontos.forEach((p, i) => {
    if (p.valor != null) {
      const c = svg("circle", { class: "g-ponto-g", cx: x(i), cy: y(p.valor), r: 4 });
      const tt = svg("title");
      tt.textContent = `${p.rotulo}: ${formato(p.valor)}`;
      c.append(tt);
      s.append(c);
    }
    if (i % passo === 0 || i === pontos.length - 1) {
      const t = svg("text", { x: x(i), y: altura - 8, "text-anchor": i === 0 ? "start" : i === pontos.length - 1 ? "end" : "middle" });
      t.textContent = p.rotulo;
      s.append(t);
    }
  });
  return s;
}

// ---------- ajudantes de dados ----------
export const MARKETPLACE_ROTULO = { ml: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok Shop" };

export function chipMarketplace(mk) {
  return chip(MARKETPLACE_ROTULO[mk] || mk, mk === "shopee" ? "g-fora" : mk === "tiktok" ? "g-neutro" : "g-amarelo");
}

export function soma2(a, b) {
  const saida = { ...a };
  for (const [dia, l] of Object.entries(b)) {
    const x = saida[dia] || {};
    saida[dia] = {};
    for (const c of ["gasto", "fatTotal", "fatAds", "pedidos", "pedidosAds", "cliques", "impressoes"]) {
      saida[dia][c] = (Number(x[c]) || 0) + (Number(l[c]) || 0);
    }
  }
  return saida;
}

export { corContraMeta, moeda, numero, percentual };

// ---------- chamada de API ----------
export function criarApi(base, { cabecalho = {} } = {}) {
  return async function api(caminho, { metodo = "GET", corpo } = {}) {
    const init = { method: metodo, credentials: "same-origin", headers: { accept: "application/json", "x-gestao": "1", ...cabecalho } };
    if (corpo !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(corpo); }
    let r;
    try { r = await fetch(base + caminho, init); } catch { throw Object.assign(new Error("Sem conexão com o servidor."), { status: 0 }); }
    let json = null;
    try { json = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok) throw Object.assign(new Error(json?.erro || `Erro ${r.status}`), { status: r.status, dados: json });
    return json;
  };
}
