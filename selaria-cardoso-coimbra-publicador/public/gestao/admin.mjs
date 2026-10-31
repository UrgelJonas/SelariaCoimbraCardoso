// Painel do dono (modo Gestão dentro da Central): login, lista de clientes e a área de cada cliente.
// Carregado sob demanda quando a aba "Gestão" é aberta. Nada daqui usa innerHTML com dados.
import { addMeses, chaveRegistro, formatarDia, hojeSP, mesDe, percentual } from "./calc.mjs";
import {
  MARKETPLACE_ROTULO, aviso, botao, chip, chipMarketplace, confirmar, criarApi, el, formulario, kpi, limpar, ponto, vazio,
} from "./ui.mjs";
import { secaoMetas, secaoPrioridades, secaoResumo, secaoTarefas } from "./secoes.mjs";
import { secaoAds, secaoDatas, secaoDiario, secaoFull, secaoRecados, secaoRelatorio } from "./secoes2.mjs";

const LOGO = "/assets/curva-a-logo.png";

const ABAS = [
  { id: "resumo", rotulo: "Resumo", desenhar: secaoResumo },
  { id: "tarefas", rotulo: "Tarefas", desenhar: secaoTarefas },
  { id: "metas", rotulo: "Metas", desenhar: secaoMetas },
  { id: "prioridades", rotulo: "Prioridades", desenhar: secaoPrioridades, contador: (c) => c.dados.prioridades.filter((p) => p.status === "nova").length },
  { id: "ads", rotulo: "Ads & TACOS", desenhar: secaoAds },
  { id: "diario", rotulo: "Diário", desenhar: secaoDiario },
  { id: "full", rotulo: "Full", desenhar: secaoFull },
  { id: "datas", rotulo: "Datas comerciais", desenhar: secaoDatas },
  { id: "recados", rotulo: "Recados e notas", desenhar: secaoRecados, contador: (c) => c.dados.recados.filter((r) => r.de === "cliente" && !r.lido).length },
  { id: "relatorio", rotulo: "Relatório", desenhar: secaoRelatorio },
];

export function iniciar(raiz, { aoSair } = {}) {
  const api = criarApi("/api/gestao");
  const apiMl = criarApi("/api/gestao-ads-ml");
  const estado = { tela: "carregando", configurado: true, clientes: [], busca: "", arquivados: false, cliente: null, aba: "resumo", ui: {}, erro: "" };
  let hoje = hojeSP();
  const q = () => "hoje=" + hoje;

  // ------------------------------------------------------------------ utilidades

  const sessaoExpirada = () => {
    estado.tela = "login";
    estado.cliente = null;
    render();
    aviso("Sua sessão da Gestão expirou. Entre de novo.", "erro");
  };

  function falha(e) {
    if (e?.status === 401 && /senha da Gest/i.test(e.message || "")) return sessaoExpirada();
    aviso(e?.message || "Algo deu errado.", "erro");
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      const t = el("textarea", { estilo: { position: "fixed", opacity: "0" } });
      t.value = texto;
      document.body.append(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      t.remove();
      return ok;
    }
  }

  const linkDoCliente = (token) => `${location.origin}/c/${token}`;

  // ------------------------------------------------------------------ estrutura

  function topo({ titulo, sub, esquerda, direita }) {
    return el("header", { class: "g-topbar" },
      esquerda || null,
      el("img", { class: "g-logo", src: LOGO, alt: "Curva A", width: 40, height: 40 }),
      el("div", { class: "g-titulo" }, titulo, sub ? el("small", { text: sub }) : null),
      el("div", { class: "g-espaco" }),
      direita || null);
  }

  function render() {
    limpar(raiz);
    raiz.className = "g-root g-app";
    if (estado.tela === "login") return raiz.append(telaLogin());
    if (estado.tela === "carregando") return raiz.append(topo({ titulo: "Gestão de clientes", sub: "Curva A" }), el("main", { class: "g-main" }, vazio("Carregando...")));
    if (estado.tela === "erro") return raiz.append(topo({ titulo: "Gestão de clientes", sub: "Curva A" }), el("main", { class: "g-main" }, el("div", { class: "g-erro-msg", text: estado.erro }), botao("Tentar de novo", { classe: "g-primario", onClick: iniciarSessao })));
    if (estado.tela === "lista") return raiz.append(telaLista());
    if (estado.tela === "cliente") return raiz.append(telaCliente());
  }

  // ------------------------------------------------------------------ login

  function telaLogin() {
    const campo = el("input", { class: "g-input", type: "password", id: "g-senha", autocomplete: "current-password", "aria-label": "Senha da Gestão", placeholder: "Senha da Gestão" });
    const msg = el("div", { class: "g-erro-msg", hidden: true });
    const entrar = botao("Entrar", { classe: "g-primario" });
    entrar.type = "submit";
    const form = el("form", { novalidate: true },
      !estado.configurado ? el("div", { class: "g-info-msg", text: "A senha da Gestão ainda não foi criada. No Netlify, cadastre a variável GESTAO_SENHA (mínimo 8 caracteres) e publique de novo." }) : null,
      msg,
      el("div", { class: "g-campo" }, el("label", { for: "g-senha", text: "Senha" }), campo),
      entrar);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      msg.hidden = true;
      if (!campo.value) { msg.textContent = "Digite a senha."; msg.hidden = false; return; }
      entrar.disabled = true;
      try {
        await api("/login", { metodo: "POST", corpo: { senha: campo.value } });
        campo.value = "";
        await carregarLista();
      } catch (e) {
        msg.textContent = e.message;
        msg.hidden = false;
        entrar.disabled = false;
        campo.select();
      }
    });
    const caixa = el("div", { class: "g-login" },
      el("img", { class: "g-logo-grande", src: LOGO, alt: "Curva A", width: 84, height: 84 }),
      el("h1", { text: "Gestão de clientes" }),
      el("div", { class: "g-sub", text: "Área restrita · Curva A" }),
      el("div", { class: "g-card" }, form),
      aoSair ? el("div", { estilo: { "margin-top": "14px" } }, botao("← Voltar para a Central Mercado Livre", { classe: "g-fantasma", onClick: aoSair })) : null);
    setTimeout(() => campo.focus(), 0);
    return caixa;
  }

  async function sair() {
    try { await api("/logout", { metodo: "POST", corpo: {} }); } catch { /* sai mesmo assim */ }
    estado.tela = "login";
    estado.cliente = null;
    render();
  }

  // ------------------------------------------------------------------ lista de clientes

  async function carregarLista() {
    hoje = hojeSP();
    estado.tela = "carregando";
    render();
    try {
      estado.clientes = (await api(`/clientes?${q()}`)).clientes;
      estado.tela = "lista";
    } catch (e) {
      if (e.status === 401) { estado.tela = "login"; } else { estado.tela = "erro"; estado.erro = e.message; }
    }
    render();
  }

  function telaLista() {
    const todos = estado.clientes;
    const ativos = todos.filter((c) => c.ativo);
    const contas = ativos.flatMap((c) => c.contas);
    const contasFora = contas.filter((c) => c.estadoTacos === "fora").length;
    const pendHoje = ativos.reduce((s, c) => s + (c.tarefas.diaria.pendentes || 0), 0);
    const recados = ativos.reduce((s, c) => s + c.recadosNovos, 0);
    const prios = ativos.reduce((s, c) => s + c.prioridadesNovas, 0);

    const busca = el("input", { class: "g-input", type: "search", placeholder: "Buscar cliente...", "aria-label": "Buscar cliente", value: estado.busca, estilo: { width: "280px" } });
    const grade = el("div", { class: "g-grid g-c3" });
    const desenharGrade = () => {
      limpar(grade);
      const termo = estado.busca.trim().toLowerCase();
      const lista = todos
        .filter((c) => (estado.arquivados ? true : c.ativo))
        .filter((c) => !termo || c.nome.toLowerCase().includes(termo) || c.contas.some((x) => x.nome.toLowerCase().includes(termo)))
        .sort((a, b) => Number(b.ativo) - Number(a.ativo) || b.contas.filter((x) => x.estadoTacos === "fora").length - a.contas.filter((x) => x.estadoTacos === "fora").length || a.nome.localeCompare(b.nome, "pt-BR"));
      if (!lista.length) { grade.append(vazio(todos.length ? "Nenhum cliente encontrado." : "Nenhum cliente ainda. Clique em “Novo cliente” para começar.")); return; }
      for (const c of lista) grade.append(cartaoCliente(c));
    };
    busca.addEventListener("input", () => { estado.busca = busca.value; desenharGrade(); });
    desenharGrade();

    const principal = el("main", { class: "g-main" },
      el("div", { class: "g-grid g-c4", estilo: { "margin-bottom": "18px" } },
        kpi("Clientes ativos", String(ativos.length), { nota: `${contas.length} conta(s) de marketplace` }),
        kpi("Contas com TACOS fora da meta", String(contasFora), { cor: contasFora ? "fora" : "ok", nota: "no mês atual" }),
        kpi("Tarefas diárias pendentes", String(pendHoje), { nota: "somando todos os clientes, hoje" }),
        kpi("Novidades dos clientes", String(recados + prios), { cor: recados + prios ? "atencao" : "neutro", nota: `${recados} recado(s) · ${prios} prioridade(s) nova(s)` })),
      el("div", { class: "g-linha g-entre", estilo: { "margin-bottom": "14px" } },
        el("div", { class: "g-linha" }, busca,
          el("label", { class: "g-check-linha" }, el("input", { type: "checkbox", checked: estado.arquivados, onchange: (ev) => { estado.arquivados = ev.target.checked; desenharGrade(); } }), "Mostrar arquivados")),
        botao("Novo cliente", { iconeNome: "mais", classe: "g-amarelo", onClick: novoCliente })),
      grade);

    return el("div", {},
      topo({
        titulo: "Gestão de clientes", sub: "Curva A · " + formatarDia(hoje),
        direita: el("div", { class: "g-linha" }, aoSair ? botao("← Central Mercado Livre", { onClick: aoSair }) : null, botao("Atualizar", { onClick: carregarLista }), botao("Sair", { onClick: sair })),
      }),
      principal);
  }

  function cartaoCliente(c) {
    const abrir = () => abrirCliente(c.id);
    const d = c.tarefas.diaria;
    const fracao = d.total ? (d.ok + d.naoOk) / d.total : 0;
    const barraT = el("div", { class: "g-barra" + (d.total && d.ok === d.total ? " g-ok" : "") }, el("span"));
    barraT.firstChild.style.width = Math.round(fracao * 100) + "%";
    const cartao = el("div", { class: "g-card g-cliente-card" + (c.ativo ? "" : " g-inativo"), role: "button", tabindex: "0", "aria-label": `Abrir ${c.nome}`, onclick: abrir },
      el("div", { class: "g-linha g-entre" },
        el("h3", { text: c.nome }),
        el("div", { class: "g-linha" },
          !c.ativo ? chip("arquivado", "g-neutro") : null,
          c.recadosNovos ? el("span", { class: "g-contador", title: "Recados novos", text: String(c.recadosNovos) }) : null,
          c.ativo && !c.tokenAtivo ? chip("sem link", "g-atencao") : null)),
      el("div", {}, c.contas.length ? c.contas.map((conta) => el("div", { class: "g-conta-linha", estilo: { padding: "3px 0" } },
        ponto(conta.estadoTacos),
        el("span", { class: "g-nome", text: `${conta.nome} · ${MARKETPLACE_ROTULO[conta.marketplace] || conta.marketplace}` }),
        el("strong", { title: conta.metaTacos != null ? `Meta de TACOS: ${percentual(conta.metaTacos)}` : "Sem meta de TACOS", text: conta.tacos == null ? "—" : percentual(conta.tacos) }))) : el("div", { class: "g-sub", text: "Nenhuma conta cadastrada." })),
      el("div", {},
        el("div", { class: "g-linha g-entre g-sub" }, el("span", { text: "Tarefas de hoje" }), el("span", { text: d.total ? `${d.ok}/${d.total} OK${d.naoOk ? ` · ${d.naoOk} não OK` : ""}` : "sem tarefas" })),
        barraT),
      el("div", { class: "g-linha" },
        c.metasFora ? chip(`${c.metasFora} meta(s) fora`, "g-fora") : chip("metas em dia", "g-ok"),
        c.prioridadesNovas ? chip(`${c.prioridadesNovas} prioridade(s) nova(s)`, "g-amarelo") : null));
    cartao.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } });
    return cartao;
  }

  // ------------------------------------------------------------------ cadastro / edição de cliente

  function editorContas(iniciais) {
    const linhas = [];
    const lista = el("div");
    const adicionar = (c = {}) => {
      const sel = el("select", { class: "g-select", "aria-label": "Marketplace", estilo: { width: "160px", flex: "none" } },
        Object.entries(MARKETPLACE_ROTULO).map(([v, r]) => el("option", { value: v, text: r, selected: v === (c.marketplace || "ml") })));
      const nome = el("input", { class: "g-input", type: "text", maxlength: 60, placeholder: "Nome da conta (ex.: Curva A Pesca)", "aria-label": "Nome da conta", value: c.nome || "" });
      const linha = { c, sel, nome, no: null };
      linha.no = el("div", { class: "g-linha", estilo: { "margin-bottom": "8px", "flex-wrap": "nowrap" } }, sel, nome,
        botao("", { iconeNome: "lixo", classe: "g-mini g-fantasma", titulo: "Remover conta", onClick: () => { linhas.splice(linhas.indexOf(linha), 1); linha.no.remove(); } }));
      linhas.push(linha);
      lista.append(linha.no);
    };
    (iniciais.length ? iniciais : [{}]).forEach(adicionar);
    const no = el("div", { class: "g-campo" },
      el("label", { text: "Contas de marketplace" }), lista,
      el("div", {}, botao("Adicionar conta", { iconeNome: "mais", classe: "g-mini", onClick: () => adicionar() })),
      el("div", { class: "g-dica", text: "Cada conta tem seus próprios lançamentos de Ads, metas e TACOS. Remover uma conta apaga os lançamentos dela." }));
    return { no, ler: () => linhas.filter((l) => l.nome.value.trim()).map((l) => ({ ...l.c, marketplace: l.sel.value, nome: l.nome.value.trim() })) };
  }

  async function dialogoCliente(inicial, editando) {
    const editor = editorContas(inicial?.contas || []);
    const v = await formulario({
      titulo: editando ? "Editar cliente" : "Novo cliente",
      campos: [
        { nome: "nome", rotulo: "Nome do cliente / marca", obrigatorio: true, max: 80 },
        { nome: "contato", rotulo: "Contato (só você vê)", max: 120, dica: "WhatsApp, e-mail..." },
        { nome: "observacao", rotulo: "Observação interna (só você vê)", tipo: "area", max: 500 },
      ],
      valores: inicial || {},
      extra: editor.no,
      confirmar: editando ? "Salvar" : "Criar cliente",
    });
    return v ? { ...v, contas: editor.ler() } : null;
  }

  // Se o servidor recusar, o formulário reabre com o que foi digitado.
  async function fluxoCliente(inicial, enviar, editando = false) {
    let valores = inicial;
    for (;;) {
      const r = await dialogoCliente(valores, editando);
      if (!r) return null;
      try {
        return await enviar(r);
      } catch (e) {
        if (e.status === 401 && /senha da Gest/i.test(e.message || "")) { sessaoExpirada(); return null; }
        aviso(e.message || "Não foi possível salvar.", "erro");
        valores = { ...(inicial || {}), ...r };
      }
    }
  }

  async function novoCliente() {
    const id = await fluxoCliente(null, async (r) => (await api("/clientes", { metodo: "POST", corpo: r })).id);
    if (!id) return;
    aviso("Cliente criado. O link dele já foi gerado.", "bom");
    await abrirCliente(id);
    abrirDialogoLink();
  }

  async function editarCliente() {
    const cli = estado.cliente;
    const antes = cli.perfil;
    const salvo = await fluxoCliente(antes, async (r) => {
      const removidas = antes.contas.filter((c) => !r.contas.some((x) => x.id === c.id));
      if (removidas.length && !(await confirmar("Remover conta", `Remover ${removidas.map((c) => `"${c.nome}"`).join(", ")} apaga todos os lançamentos de Ads dessa(s) conta(s). Continuar?`, "Remover e salvar"))) {
        throw new Error("Nada foi alterado.");
      }
      const ok = await salvarPerfil({ nome: r.nome, contato: r.contato, observacao: r.observacao, contas: r.contas, ativo: antes.ativo !== false }, true);
      if (!ok) throw new Error("Não foi possível salvar. Tente de novo.");
      return true;
    }, true);
    if (salvo) aviso("Cliente atualizado.", "bom");
  }

  async function alternarArquivo() {
    const cli = estado.cliente;
    const ativoAgora = cli.perfil.ativo !== false;
    if (ativoAgora && !(await confirmar("Arquivar cliente", `Arquivar "${cli.perfil.nome}"? O link dele deixa de abrir até você reativar. Nada é apagado.`, "Arquivar", false))) return;
    const p = cli.perfil;
    const ok = await salvarPerfil({ nome: p.nome, contato: p.contato, observacao: p.observacao, contas: p.contas, ativo: !ativoAgora });
    if (ok) aviso(ativoAgora ? "Cliente arquivado." : "Cliente reativado.", "bom");
  }

  async function excluirCliente() {
    const cli = estado.cliente;
    const v = await formulario({
      titulo: "Excluir cliente",
      textoIntro: `Isto apaga para sempre tudo de "${cli.perfil.nome}": tarefas, metas, lançamentos de Ads, recados e o link. Não dá para desfazer. Se só quer parar de ver, use “Arquivar”.`,
      campos: [{ nome: "confirmarNome", rotulo: "Digite o nome do cliente para confirmar", obrigatorio: true, max: 80 }],
      confirmar: "Excluir definitivamente", perigo: true,
    });
    if (!v) return;
    try {
      await api(`/clientes/${cli.id}`, { metodo: "DELETE", corpo: { confirmarNome: v.confirmarNome } });
      aviso("Cliente excluído.", "bom");
      estado.cliente = null;
      await carregarLista();
    } catch (e) { falha(e); }
  }

  // ------------------------------------------------------------------ link do cliente

  function abrirDialogoLink() {
    const cli = estado.cliente;
    if (!cli) return;
    const token = cli.perfil.token;
    const dlg = el("dialog", { class: "g-root g-dialogo" });
    const fechar = () => { dlg.close(); dlg.remove(); };
    const corpo = el("div", { class: "g-corpo" });
    const rodape = el("footer");
    const reabrir = () => { fechar(); abrirDialogoLink(); };

    if (cli.perfil.ativo === false) corpo.append(el("div", { class: "g-info-msg", text: "Este cliente está arquivado: o link não abre enquanto ele estiver arquivado." }));

    if (token) {
      const url = linkDoCliente(token);
      const campo = el("input", { class: "g-input", type: "text", readonly: true, value: url, "aria-label": "Link do cliente", onfocus: (ev) => ev.target.select() });
      corpo.append(
        el("p", { class: "g-sub", text: "Mande este link para o cliente. Ele vê somente os dados dele, nunca os de outros clientes, e não precisa de senha. Quem tiver o link consegue abrir — por isso envie só para ele." }),
        el("div", { class: "g-campo" }, el("label", { text: "Link do cliente" }), campo),
        el("div", { class: "g-dica", text: "Se o link vazar, gere um novo: o antigo para de funcionar na hora." }));
      rodape.append(
        botao("Revogar acesso", { classe: "g-perigo", onClick: async () => {
          if (!(await confirmar("Revogar acesso", "O cliente deixará de conseguir abrir o link. Você pode gerar outro depois.", "Revogar"))) return;
          if (await mudarToken("revogar")) { aviso("Acesso revogado.", "bom"); reabrir(); }
        } }),
        botao("Gerar novo link", { onClick: async () => {
          if (!(await confirmar("Gerar novo link", "O link atual deixa de funcionar. Você precisará enviar o novo ao cliente.", "Gerar novo", false))) return;
          if (await mudarToken("gerar")) { aviso("Novo link gerado.", "bom"); reabrir(); }
        } }),
        botao("Abrir como cliente", { onClick: () => window.open(url, "_blank", "noopener,noreferrer") }),
        botao("Copiar link", { classe: "g-primario", onClick: async () => { const ok = await copiar(url); aviso(ok ? "Link copiado." : "Não consegui copiar. Selecione o link e copie.", ok ? "bom" : "erro"); } }));
    } else {
      corpo.append(el("p", { class: "g-sub", text: "Este cliente está sem link ativo. Gere um link para ele acompanhar os resultados." }));
      rodape.append(botao("Gerar link", { classe: "g-primario", onClick: async () => { if (await mudarToken("gerar")) { aviso("Link gerado.", "bom"); reabrir(); } } }));
    }
    rodape.prepend(botao("Fechar", { onClick: fechar }));
    dlg.addEventListener("cancel", (ev) => { ev.preventDefault(); fechar(); });
    dlg.append(el("form", { method: "dialog", onsubmit: (ev) => ev.preventDefault() }, el("header", {}, el("h3", { text: `Link de ${cli.perfil.nome}` })), corpo, rodape));
    document.body.append(dlg);
    dlg.showModal();
  }

  async function mudarToken(acao) {
    const cli = estado.cliente;
    try {
      const r = await api(`/clientes/${cli.id}/token`, { metodo: "POST", corpo: { acao } });
      cli.perfil = { ...cli.perfil, token: r.token, tokenCriadoEm: r.token ? new Date().toISOString() : null };
      // o servidor regravou o perfil: pega a revisão nova para não dar conflito depois
      const p = await api(`/clientes/${cli.id}/perfil`);
      cli.perfil = p.dados;
      cli.revs.perfil = p.rev;
      return true;
    } catch (e) { falha(e); return false; }
  }

  // ------------------------------------------------------------------ cliente aberto

  async function abrirCliente(id, aba = "resumo") {
    hoje = hojeSP();
    estado.tela = "carregando";
    render();
    try {
      const doc = await api(`/clientes/${id}?${q()}`);
      montarCliente(doc);
      estado.aba = ABAS.some((a) => a.id === aba) ? aba : "resumo";
      estado.tela = "cliente";
      estado.ui = {};
      if (estado.aba === "recados") marcarLidos();
    } catch (e) {
      if (e.status === 401) estado.tela = "login";
      else { estado.tela = "erro"; estado.erro = e.message; }
    }
    render();
  }

  function montarCliente(doc) {
    const carregados = new Set();
    for (const [contaId, meses] of Object.entries(doc.ads || {})) for (const m of Object.keys(meses)) carregados.add(contaId + "|" + m);
    const ano = Number(hoje.slice(0, 4));
    const cli = {
      id: doc.id, perfil: doc.perfil, revs: doc.revs, carregados, anos: new Set([String(ano), String(ano - 1)]), fila: Promise.resolve(),
      dados: {
        nomeCliente: doc.perfil.nome, contas: doc.perfil.contas, tarefas: doc.tarefas, metas: doc.metas, prioridades: doc.prioridades, recados: doc.recados,
        diario: doc.diario, full: doc.full, datas: doc.datas, notas: doc.notas, registros: doc.registros, ads: doc.ads,
      },
    };
    const ctx = {
      modo: "admin",
      get hoje() { return hoje; },
      get ui() { return estado.ui; },
      dados: cli.dados,
      rerender: () => rerender(),
      acoes: acoesDe(cli),
    };
    cli.ctx = ctx;
    estado.cliente = cli;
  }

  function rerender() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  async function recarregar() {
    const cli = estado.cliente;
    if (cli) await abrirCliente(cli.id, estado.aba);
  }

  function marcarLidos() {
    const cli = estado.cliente;
    if (!cli || !cli.dados.recados.some((r) => r.de === "cliente" && !r.lido)) return;
    cli.dados.recados = cli.dados.recados.map((r) => (r.de === "cliente" ? { ...r, lido: true } : r));
    api(`/clientes/${cli.id}/recados`, { metodo: "POST", corpo: { acao: "lidos" } }).catch(() => {});
  }

  function telaCliente() {
    const cli = estado.cliente;
    const p = cli.perfil;
    const arquivado = p.ativo === false;

    const abas = el("div", { class: "g-abas g-nao-imprimir", role: "tablist", "aria-label": "Seções do cliente" }, ABAS.map((a) => {
      const n = a.contador ? a.contador(cli.ctx) : 0;
      return el("button", {
        type: "button", class: "g-aba", role: "tab", "aria-selected": String(estado.aba === a.id),
        onclick: () => { estado.aba = a.id; if (a.id === "recados") marcarLidos(); rerender(); },
      }, a.rotulo, n ? el("span", { class: "g-contador", text: String(n) }) : null);
    }));

    const area = el("div", { role: "tabpanel" });
    try {
      area.append(ABAS.find((a) => a.id === estado.aba).desenhar(cli.ctx));
    } catch (e) {
      console.error("Gestão:", e);
      area.append(el("div", { class: "g-erro-msg", text: "Não consegui montar esta tela: " + (e?.message || "erro desconhecido") }));
    }

    return el("div", {},
      topo({
        titulo: p.nome, sub: "Gestão de clientes · Curva A",
        esquerda: botao("← Clientes", { onClick: carregarLista }),
        direita: el("div", { class: "g-linha" }, botao("Link do cliente", { classe: "g-amarelo", onClick: abrirDialogoLink }), botao("Sair", { onClick: sair })),
      }),
      el("main", { class: "g-main" },
        el("div", { class: "g-linha g-entre g-nao-imprimir" },
          el("div", { class: "g-linha" },
            arquivado ? chip("arquivado", "g-neutro") : null,
            p.contas.map((c) => el("span", {}, chipMarketplace(c.marketplace), " ", el("span", { class: "g-sub", text: c.nome }))),
            p.contato ? el("span", { class: "g-sub", text: "· " + p.contato }) : null),
          el("div", { class: "g-linha" },
            botao("Editar cliente", { classe: "g-mini", onClick: editarCliente }),
            botao(arquivado ? "Reativar" : "Arquivar", { classe: "g-mini", onClick: alternarArquivo }),
            botao("Excluir", { classe: "g-mini g-perigo", onClick: excluirCliente }))),
        abas, area));
  }

  // ------------------------------------------------------------------ ações usadas pelas telas

  function enfileirar(cli, fn) {
    const p = cli.fila.then(fn);
    cli.fila = p.catch(() => {});
    return p;
  }

  async function salvarPerfil(dados, silencioso = false) {
    const cli = estado.cliente;
    return enfileirar(cli, async () => {
      try {
        const r = await api(`/clientes/${cli.id}/perfil`, { metodo: "PUT", corpo: { rev: cli.revs.perfil, dados } });
        const removidas = Object.keys(cli.dados.ads || {}).filter((id) => !r.dados.contas.some((c) => c.id === id));
        for (const id of removidas) delete cli.dados.ads[id];
        cli.perfil = r.dados;
        cli.revs.perfil = r.rev;
        cli.dados.contas = r.dados.contas;
        cli.dados.nomeCliente = r.dados.nome;
        rerender();
        return true;
      } catch (e) {
        if (silencioso) throw e;
        await falhaAoSalvar(e);
        return false;
      }
    });
  }

  async function falhaAoSalvar(e) {
    if (e?.status === 409 && !/vincul|Mercado Livre/i.test(e.message || "")) {
      aviso("Estes dados mudaram em outra tela. Recarreguei a versão mais recente; repita a alteração.", "erro");
      await recarregar();
    } else falha(e);
  }

  function acoesDe(cli) {
    const acoes = {
      marcarTarefa(t, periodo, status, motivo, focarId) {
        const k = chaveRegistro(t.id, periodo);
        const antes = cli.dados.registros[k];
        if (status) cli.dados.registros[k] = { status, motivo: motivo || "", em: new Date().toISOString() };
        else delete cli.dados.registros[k];
        rerender();
        if (focarId) document.getElementById("motivo-" + focarId)?.focus();
        return enfileirar(cli, async () => {
          try {
            await api(`/clientes/${cli.id}/registro`, { metodo: "POST", corpo: { tarefaId: t.id, periodo, status, motivo: motivo || "" } });
          } catch (e) {
            if (antes) cli.dados.registros[k] = antes; else delete cli.dados.registros[k];
            rerender();
            falha(e);
          }
        });
      },

      salvarLista(secao, lista) {
        return enfileirar(cli, async () => {
          try {
            const r = await api(`/clientes/${cli.id}/${secao}`, { metodo: "PUT", corpo: { rev: cli.revs[secao], dados: lista } });
            cli.dados[secao] = r.dados;
            cli.revs[secao] = r.rev;
            rerender();
            return true;
          } catch (e) {
            await falhaAoSalvar(e);
            return false;
          }
        });
      },

      salvarPrioridades: (lista) => acoes.salvarLista("prioridades", lista),

      async salvarNotas(texto) {
        if (await acoes.salvarLista("notas", { texto })) aviso("Notas salvas.", "bom");
      },

      salvarConta(contaId, patch) {
        const p = cli.perfil;
        return salvarPerfil({ nome: p.nome, contato: p.contato, observacao: p.observacao, ativo: p.ativo !== false, contas: p.contas.map((c) => (c.id === contaId ? { ...c, ...patch } : c)) });
      },

      async carregarAds(contaId, meses) {
        const faltam = meses.filter((m) => !cli.carregados.has(contaId + "|" + m));
        if (!faltam.length) return;
        const r = await api(`/clientes/${cli.id}/ads?conta=${encodeURIComponent(contaId)}&meses=${faltam.join(",")}`);
        const alvo = (cli.dados.ads[contaId] ||= {});
        for (const [m, d] of Object.entries(r.ads)) { alvo[m] = d; cli.carregados.add(contaId + "|" + m); }
      },

      lancarAds(contaId, dias) {
        return enfileirar(cli, async () => {
          try {
            await api(`/clientes/${cli.id}/ads`, { metodo: "POST", corpo: { contaId, dias } });
            await recarregarMeses(cli, contaId, [...new Set(Object.keys(dias).map(mesDe))]);
            rerender();
            return true;
          } catch (e) { falha(e); return false; }
        });
      },

      async importarMl(conta, de, ate) {
        const corpo = { clienteId: cli.id, contaId: conta.id, de, ate, hoje };
        aviso("Importando do Mercado Livre... isso pode levar alguns segundos.");
        try {
          let r;
          try {
            r = await apiMl("", { metodo: "POST", corpo });
          } catch (e) {
            if (e.status === 409 && e.dados?.precisaVincular) {
              const ok = await confirmar("Vincular conta do Mercado Livre", `A conta conectada agora na Central é "${e.dados.nickname}". Vincular a "${conta.nome}" deste cliente? Depois disso, só ela poderá importar para esta conta.`, "Vincular e importar", false);
              if (!ok) return;
              r = await apiMl("", { metodo: "POST", corpo: { ...corpo, vincular: true } });
            } else throw e;
          }
          const meses = [];
          for (let m = mesDe(de); m <= mesDe(ate); m = addMeses(m, 1)) meses.push(m);
          await recarregarMeses(cli, conta.id, meses);
          const p = await api(`/clientes/${cli.id}/perfil`);
          cli.perfil = p.dados; cli.revs.perfil = p.rev; cli.dados.contas = p.dados.contas;
          rerender();
          const falhas = r.falhas?.length ? ` ${r.falhas.length} dia(s) falharam (${r.falhas[0].erro}).` : "";
          aviso(`${r.importados} dia(s) importados de "${r.conta?.nickname || "Mercado Livre"}".${falhas}`, r.falhas?.length ? "" : "bom");
        } catch (e) {
          // 401 aqui costuma ser a conta do Mercado Livre desconectada, não a sessão da Gestão
          if (e.status === 401 && /senha da Gest/i.test(e.message || "")) sessaoExpirada();
          else aviso(e.message || "Não foi possível importar.", "erro");
        }
      },

      async enviarRecado(texto) {
        return enfileirar(cli, async () => {
          try {
            const r = await api(`/clientes/${cli.id}/recados`, { metodo: "POST", corpo: { texto } });
            cli.dados.recados = [...cli.dados.recados, r.recado];
            rerender();
            return true;
          } catch (e) { falha(e); return false; }
        });
      },

      async garantirRegistros(ano) {
        if (cli.anos.has(ano)) return;
        const r = await api(`/clientes/${cli.id}/registros/${ano}`);
        Object.assign(cli.dados.registros, r.registros);
        cli.anos.add(ano);
      },
    };
    return acoes;
  }

  async function recarregarMeses(cli, contaId, meses) {
    for (const m of meses) cli.carregados.delete(contaId + "|" + m);
    const r = await api(`/clientes/${cli.id}/ads?conta=${encodeURIComponent(contaId)}&meses=${meses.join(",")}`);
    const alvo = (cli.dados.ads[contaId] ||= {});
    for (const [m, d] of Object.entries(r.ads)) { alvo[m] = d; cli.carregados.add(contaId + "|" + m); }
  }

  // ------------------------------------------------------------------ início

  async function iniciarSessao() {
    estado.tela = "carregando";
    render();
    try {
      const s = await api("/sessao");
      estado.configurado = s.configurado;
      if (s.autenticado) return carregarLista();
      estado.tela = "login";
    } catch (e) {
      estado.tela = "erro";
      estado.erro = e.message;
    }
    render();
  }

  iniciarSessao();

  return {
    // chamado quando o dono volta para a aba Gestão: atualiza a lista se ele estava nela
    retomar() {
      if (estado.tela === "lista") carregarLista();
    },
  };
}
