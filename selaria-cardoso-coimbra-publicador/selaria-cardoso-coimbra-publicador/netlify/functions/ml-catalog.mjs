import { bodyJson, HttpError, itemIdValido, jsonInit, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';

async function contextoItem(atual, itemId) {
  if (!itemIdValido(itemId)) throw new HttpError('ID de anúncio inválido.', 400);
  const [item, eligibility] = await Promise.all([
    mlJson(atual, `/items/${encodeURIComponent(itemId)}`),
    mlJson(atual, `/items/${encodeURIComponent(itemId)}/catalog_listing_eligibility`),
  ]);
  return { item: item.data, eligibility: eligibility.data };
}

async function fazerOptin(atual, body) {
  const itemId = String(body.item_id || '').trim().toUpperCase();
  const ctx = await contextoItem(atual, itemId);
  const status = String(ctx.eligibility?.status || '');
  if (status && status !== 'READY_FOR_OPTIN' && status !== 'ALREADY_OPTED_IN') {
    throw new HttpError(`Este anúncio não está pronto para catálogo (${status}).`, 400, ctx.eligibility);
  }
  if (status === 'ALREADY_OPTED_IN' || ctx.item?.catalog_listing === true) {
    return { ok: true, already: true, eligibility: ctx.eligibility, item: ctx.item };
  }

  const variationId = body.variation_id == null || body.variation_id === '' ? null : Number(body.variation_id);
  let catalogProductId = String(body.catalog_product_id || ctx.item?.catalog_product_id || '').trim();
  if (variationId) {
    const variation = Array.isArray(ctx.item?.variations) ? ctx.item.variations.find(v => Number(v.id) === variationId) : null;
    if (!variation) throw new HttpError('Variação não encontrada no anúncio.', 400);
    catalogProductId = String(body.catalog_product_id || variation.catalog_product_id || ctx.item?.catalog_product_id || '').trim();
    const eligVar = Array.isArray(ctx.eligibility?.variations) ? ctx.eligibility.variations.find(v => Number(v.id) === variationId) : null;
    if (eligVar && eligVar.status !== 'READY_FOR_OPTIN' && eligVar.status !== 'ALREADY_OPTED_IN') {
      throw new HttpError(`Esta variação não está pronta para catálogo (${eligVar.status}).`, 400, eligVar);
    }
    if (eligVar && eligVar.status === 'ALREADY_OPTED_IN') {
      return { ok: true, already: true, eligibility: eligVar, item: ctx.item, variation_id: variationId };
    }
  }

  if (!catalogProductId) throw new HttpError('O Mercado Livre ainda não associou um catalog_product_id. Aguarde a produtização ou informe um produto de catálogo exato.', 400);
  const product = (await mlJson(atual, `/products/${encodeURIComponent(catalogProductId)}`)).data;
  if (String(product?.status || '').toLowerCase() !== 'active') throw new HttpError('O produto de catálogo associado não está ativo.', 400, product);
  if (Array.isArray(product?.children_ids) && product.children_ids.length) {
    throw new HttpError('O catalog_product_id é genérico (pai). Escolha um produto filho específico que corresponda exatamente ao seu produto.', 400, { children_ids: product.children_ids });
  }

  const payload = { item_id: itemId, catalog_product_id: catalogProductId };
  if (variationId) payload.variation_id = variationId;
  const r = await mlJson(atual, '/items/catalog_listings', jsonInit('POST', payload));
  return { ok: true, result: r.data, source_item: ctx.item, catalog_product: product, variation_id: variationId };
}

export default async (req) => {
  try {
    const atual = await sessaoObrigatoria(req);
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const itemId = String(url.searchParams.get('item_id') || '').trim().toUpperCase();
      const ctx = await contextoItem(atual, itemId);
      let product = null, product_error = null;
      const cpid = String(ctx.item?.catalog_product_id || '').trim();
      if (cpid) {
        try { product = (await mlJson(atual, `/products/${encodeURIComponent(cpid)}`)).data; }
        catch (e) { product_error = e.message; }
      }
      return respostaComSessao(atual, { ...ctx, catalog_product: product, catalog_product_error: product_error });
    }

    if (req.method !== 'POST') throw new HttpError('Use GET ou POST.', 405);
    const body = await bodyJson(req);

    if (body.action === 'bulk_optin') {
      const targets = Array.isArray(body.targets) ? body.targets.slice(0, 50) : [];
      if (!targets.length) throw new HttpError('Envie pelo menos um produto para catálogo.', 400);
      const results = [];
      for (const target of targets) {
        const itemId = String(target?.item_id || '').trim().toUpperCase();
        const variationId = target?.variation_id == null || target?.variation_id === '' ? null : Number(target.variation_id);
        try {
          const result = await fazerOptin(atual, target || {});
          results.push({ ok: true, item_id: itemId, variation_id: variationId, already: !!result.already, result: result.result || null });
        } catch (e) {
          results.push({ ok: false, item_id: itemId, variation_id: variationId, erro: e?.message || 'Falha ao criar catálogo.', detalhes: e?.details || null });
        }
      }
      return respostaComSessao(atual, { ok: results.every(r => r.ok), results });
    }

    const result = await fazerOptin(atual, body);
    return respostaComSessao(atual, result);
  } catch (erro) {
    console.error('Falha em catálogo:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/catalog' };
