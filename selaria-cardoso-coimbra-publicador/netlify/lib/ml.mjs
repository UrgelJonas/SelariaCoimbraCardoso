import { obterSessao, resposta } from './sessao.mjs';

export class HttpError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}



export const EMPTY_GTIN_REASON_IDS = Object.freeze({
  "17055158": "17055158",
  "17055159": "17055159",
  "17055160": "17055160",
  "17055161": "17055161",
  "artesanal": "17055158",
  "o produto é uma peça artesanal": "17055158",
  "o produto e uma peca artesanal": "17055158",
  "kit": "17055159",
  "o produto é um kit ou pack": "17055159",
  "o produto e um kit ou pack": "17055159",
  "não registrado": "17055160",
  "nao registrado": "17055160",
  "o produto não tem código cadastrado": "17055160",
  "o produto nao tem codigo cadastrado": "17055160",
  "outro": "17055161",
  "outro motivo": "17055161",
});

function chaveTexto(v) {
  return String(v ?? "").trim().toLocaleLowerCase("pt-BR");
}

function motivoGtinId(valor) {
  const chave = chaveTexto(valor);
  return EMPTY_GTIN_REASON_IDS[chave] || null;
}

function normalizarListaAtributos(lista) {
  if (!Array.isArray(lista)) return [];
  const temGtin = lista.some((a) => String(a?.id || "").toUpperCase() === "GTIN" && String(a?.value_name ?? a?.value_id ?? "").trim());
  const saida = [];
  for (const original of lista) {
    if (!original || (!original.id && !original.name)) continue;

    // User Products aceita atributos customizados usando { name, value_name }.
    // Eles são úteis quando a categoria não possui um CHILD_PK oficial para a
    // grade comercial do vendedor (por exemplo, tamanhos específicos de perneira).
    if (!original.id && original.name) {
      const nome = String(original.name).trim();
      const valor = original.value_name ?? original.value_id;
      if (!nome || valor == null || String(valor).trim() === "") continue;
      saida.push({ name: nome, value_name: String(valor).trim() });
      continue;
    }

    const a = { ...original, id: String(original.id).toUpperCase() };
    if (a.id === "EMPTY_GTIN_REASON") {
      if (temGtin) continue;
      const id = motivoGtinId(a.value_id || a.value_name);
      if (!id) continue;
      saida.push({ id: "EMPTY_GTIN_REASON", value_id: id });
      continue;
    }
    const valor = a.value_id ?? a.value_name;
    if (valor == null || String(valor).trim() === "") continue;
    saida.push(a);
  }
  return saida;
}

export function normalizarItemPayload(original) {
  if (!original || typeof original !== "object") throw new HttpError("Envie um anúncio válido.", 400);
  const item = structuredClone(original);
  if (item.family_name) {
    item.family_name = String(item.family_name).trim();
    delete item.title;
    if (Array.isArray(item.variations) && item.variations.length) {
      throw new HttpError("Esta conta usa User Products: não envie o array variations junto com family_name. Publique uma combinação por item, mantendo o mesmo family_name.", 400);
    }
    delete item.variations;
  } else if (item.title) {
    item.title = String(item.title).trim();
    delete item.family_name;
  }
  item.attributes = normalizarListaAtributos(item.attributes);
  if (!item.attributes.length) delete item.attributes;
  if (Array.isArray(item.variations)) {
    item.variations = item.variations.map((v) => {
      const x = { ...v };
      x.attributes = normalizarListaAtributos(x.attributes);
      if (!x.attributes.length) delete x.attributes;
      return x;
    });
  }
  // O publicador não força ME1/ME2. A modalidade depende das preferências
  // do seller e da categoria; o Mercado Livre completa ME2 quando obrigatório.
  if (item.shipping && typeof item.shipping === 'object') {
    const shipping = { ...item.shipping };
    delete shipping.mode;
    if (typeof shipping.free_shipping !== 'boolean') delete shipping.free_shipping;
    if (typeof shipping.local_pick_up !== 'boolean') delete shipping.local_pick_up;
    if (Object.keys(shipping).length) item.shipping = shipping;
    else delete item.shipping;
  }
  return item;
}


const AVISOS_VALIDACAO_CONHECIDOS = [
  /user has not mode me1/i,
  /mandatory free shipping added/i,
  /me2 adoption is mandatory/i,
];

function causaEhAviso(causa) {
  const tipo = String(causa?.type || '').toLowerCase();
  if (tipo === 'warning') return true;
  if (tipo === 'error') return false;
  const texto = String(causa?.message || causa?.code || causa?.error_code || '');
  return AVISOS_VALIDACAO_CONHECIDOS.some((re) => re.test(texto));
}

export function traduzirAvisoMl(causa) {
  const texto = String(causa?.message || causa?.code || causa?.error_code || '').trim();
  const codigo = String(causa?.code || '').trim();
  if (/user has not mode me1/i.test(texto)) {
    return 'Sua conta não possui Mercado Envios 1 (ME1). O Mercado Livre usará o modo de envio habilitado na conta, normalmente ME2.';
  }
  if (/mandatory free shipping added/i.test(texto)) {
    return 'O Mercado Livre definiu frete grátis como obrigatório para este anúncio e aplicará essa regra automaticamente.';
  }
  if (codigo === 'shipping.me2_adoption_mandatory' || /me2 adoption is mandatory/i.test(texto)) {
    return 'Mercado Envios 2 (ME2) é obrigatório para sua conta e será aplicado automaticamente.';
  }
  return texto || 'O Mercado Livre retornou um aviso informativo.';
}

export function analisarValidacaoMl(dados) {
  const causas = Array.isArray(dados?.cause) ? dados.cause : [];
  const warnings = [];
  const errors = [];
  for (const causa of causas) {
    if (causaEhAviso(causa)) warnings.push(causa);
    else errors.push(causa);
  }
  return { warnings, errors };
}

export function itemIdValido(id) {
  return /^MLB\d+$/.test(String(id || '').trim().toUpperCase());
}

export function categoriaValida(id) {
  return /^MLB\d+$/.test(String(id || '').trim().toUpperCase());
}

export async function bodyJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError('Envie um JSON válido.', 400);
  }
}

export async function sessaoObrigatoria(req) {
  const atual = await obterSessao(req);
  if (!atual) throw new HttpError('Conecte sua conta do Mercado Livre novamente.', 401);
  return atual;
}

export async function lerRespostaMl(r) {
  const texto = await r.text();
  if (!texto) return null;
  try { return JSON.parse(texto); } catch { return { raw: texto }; }
}

export function mensagemMl(dados, fallback = 'O Mercado Livre recusou a solicitação.') {
  if (!dados) return fallback;
  const analise = analisarValidacaoMl(dados);
  const causasFonte = analise.errors.length ? analise.errors : (Array.isArray(dados.cause) ? dados.cause : []);
  const causas = causasFonte.map((c) => c?.message || c?.code || c?.error_code).filter(Boolean);
  const cabecalho = analise.errors.length ? (dados.message || dados.error || fallback) : fallback;
  const bruto = [cabecalho, ...causas].filter(Boolean).join(' | ');
  const t = bruto.toLowerCase();
  if (t.includes('empty_gtin_reason')) return 'Motivo de ausência de GTIN inválido. Se o produto não tem código, escolha um motivo válido da categoria; se tem EAN/GTIN, deixe o motivo vazio.';
  if (t.includes('variations') && t.includes('family_name')) return 'Conta User Products: não use o array variations junto com family_name. Cada combinação deve ser publicada como um item separado da mesma família.';
  if (t.includes('family_name') && (t.includes('required') || t.includes('does not contain'))) return 'Conta User Products: o family_name é obrigatório. Informe o nome genérico da família e tente novamente.';
  if (t.includes('required_fields')) return 'Faltam campos obrigatórios para esta categoria. Consulte a categoria, preencha os atributos marcados como obrigatórios e valide novamente. Detalhe: ' + bruto;
  if (t.includes('no permissions found for user_id')) return 'O Mercado Livre não habilitou este recurso para a conta atual. Se for Product Ads, ative em Mercado Livre > Meu perfil > Publicidade. Se você alterou permissões no DevCenter, saia e conecte novamente para renovar a autorização.';
  if (t.includes('forbidden') || t.includes('not authorized') || t.includes('unauthorized') || t.includes('insufficient permission')) return 'A autorização atual do Mercado Livre não permite esta operação. Confirme as permissões no DevCenter e depois use “Sair da conta” e “Conectar conta” novamente.';
  return bruto;
}

export async function mlFetch(atual, path, init = {}, apiVersion = null) {
  const headers = new Headers(init.headers || {});
  headers.set('authorization', 'Bearer ' + atual.sessao.access_token);
  headers.set('accept', 'application/json');
  if (apiVersion) headers.set('api-version', String(apiVersion));
  const url = path.startsWith('http') ? path : 'https://api.mercadolibre.com' + path;
  return fetch(url, { ...init, headers });
}

export async function mlJson(atual, path, init = {}, apiVersion = null) {
  const r = await mlFetch(atual, path, init, apiVersion);
  const dados = await lerRespostaMl(r);
  if (!r.ok) throw new HttpError(mensagemMl(dados), r.status, dados);
  return { data: dados, status: r.status };
}

export function respostaComSessao(atual, dados, status = 200) {
  return resposta(dados, status, atual?.cookie ? [atual.cookie] : []);
}

export function respostaErro(erro) {
  const status = Number(erro?.status) || 500;
  const corpo = { erro: erro?.message || 'Erro interno.' };
  if (erro?.details) corpo.detalhes = erro.details;
  return resposta(corpo, status);
}

export function jsonInit(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
