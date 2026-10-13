import { bodyJson, jsonInit, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria, HttpError, normalizarItemPayload } from '../lib/ml.mjs';

const LISTING_TYPES = new Set(['gold_special', 'gold_pro', 'free']);

function normalizarCondicoes(raw, item) {
  const lista = Array.isArray(raw) && raw.length ? raw : [{ listing_type_id: item.listing_type_id, price: item.price }];
  const out = [];
  const usados = new Set();
  for (const c of lista) {
    const type = String(c?.listing_type_id || '').trim();
    const price = Number(c?.price);
    if (!LISTING_TYPES.has(type)) throw new HttpError('Tipo de anúncio inválido: ' + type, 400);
    if (!Number.isFinite(price) || price <= 0) throw new HttpError('Preço inválido para ' + type + '.', 400);
    if (usados.has(type)) continue;
    usados.add(type);
    out.push({ listing_type_id: type, price });
  }
  if (!out.length) throw new HttpError('Selecione pelo menos um tipo de anúncio.', 400);
  return out;
}

function bodyCondicaoVenda(item, condicao) {
  const body = {
    price: condicao.price,
    category_id: item.category_id,
    currency_id: item.currency_id,
    buying_mode: item.buying_mode,
    listing_type_id: condicao.listing_type_id,
  };
  for (const campo of ['shipping', 'channels', 'tags', 'sale_terms', 'catalog_listing', 'catalog_product_id', 'official_store_id']) {
    if (item[campo] !== undefined) body[campo] = item[campo];
  }
  return body;
}

async function salvarDescricao(atual, itemId, descricao) {
  if (!descricao || !itemId) return { ok: true, error: null };
  try {
    await mlJson(atual, `/items/${encodeURIComponent(itemId)}/description`, jsonInit('POST', { plain_text: descricao }));
    return { ok: true, error: null };
  } catch (erro) {
    return { ok: false, error: erro.message };
  }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'Use POST.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const body = await bodyJson(req);
    if (!body?.item || typeof body.item !== 'object') throw new HttpError('Envie o anúncio em item.', 400);

    const itemNormalizado = normalizarItemPayload(body.item);
    const condicoes = normalizarCondicoes(body.listing_conditions, itemNormalizado);
    if (!itemNormalizado.family_name && condicoes.length > 1) {
      throw new HttpError('Publicar Clássico e Premium juntos exige User Products. Para conta legada, publique um tipo por vez.', 400);
    }

    // A primeira condição cria o User Product/item. As demais condições de venda
    // são adicionadas ao mesmo User Product pelo endpoint atual de PxV.
    itemNormalizado.listing_type_id = condicoes[0].listing_type_id;
    itemNormalizado.price = condicoes[0].price;

    const criado = await mlJson(atual, '/items', jsonInit('POST', itemNormalizado));
    const item = criado.data || {};
    const descricao = String(body.description || '').trim();
    const descPrimary = await salvarDescricao(atual, item.id, descricao);

    const resultados = [{
      primary: true,
      ok: true,
      listing_type_id: item.listing_type_id || condicoes[0].listing_type_id,
      price: item.price ?? condicoes[0].price,
      id: item.id,
      title: item.title,
      permalink: item.permalink,
      status: item.status,
      description_ok: descPrimary.ok,
      description_error: descPrimary.error,
    }];

    let partial = false;
    if (condicoes.length > 1) {
      const upId = item.user_product_id;
      if (!upId) {
        partial = true;
        for (const extra of condicoes.slice(1)) resultados.push({
          primary: false,
          ok: false,
          listing_type_id: extra.listing_type_id,
          price: extra.price,
          error: 'O Mercado Livre criou o anúncio principal, mas não retornou user_product_id para adicionar a segunda condição de venda.',
        });
      } else {
        for (const extra of condicoes.slice(1)) {
          try {
            const bodyExtra = bodyCondicaoVenda(itemNormalizado, extra);
            const r = await mlJson(atual, `/user-products/${encodeURIComponent(upId)}/items`, jsonInit('POST', bodyExtra));
            const extraItem = r.data || {};
            const desc = await salvarDescricao(atual, extraItem.id, descricao);
            resultados.push({
              primary: false,
              ok: true,
              listing_type_id: extraItem.listing_type_id || extra.listing_type_id,
              price: extraItem.price ?? extra.price,
              id: extraItem.id,
              title: extraItem.title,
              permalink: extraItem.permalink,
              status: extraItem.status,
              description_ok: desc.ok,
              description_error: desc.error,
            });
          } catch (erro) {
            partial = true;
            resultados.push({ primary: false, ok: false, listing_type_id: extra.listing_type_id, price: extra.price, error: erro.message });
          }
        }
      }
    }

    return respostaComSessao(atual, {
      published: true,
      partial,
      id: item.id,
      title: item.title,
      permalink: item.permalink,
      status: item.status,
      user_product_id: item.user_product_id || null,
      warnings: item.warnings || [],
      description_ok: descPrimary.ok,
      description_error: descPrimary.error,
      conditions: resultados,
      raw: item,
    }, 201);
  } catch (erro) {
    console.error('Falha ao publicar anúncio:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/publish' };
