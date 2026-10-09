import { bodyJson, itemIdValido, jsonInit, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria, HttpError } from '../lib/ml.mjs';

function isoLocalDate(value, label) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/.test(s)) throw new HttpError(`Informe ${label} no formato de data válido.`, 400);
  return s.includes('T') ? s : `${s}T00:00:00`;
}


async function aplicarItemCampanha(atual, promotionId, entry) {
  const itemId = String(entry?.item_id || '').trim().toUpperCase();
  if (!itemIdValido(itemId)) return { ok: false, item_id: itemId || null, product_name: entry?.product_name || '', error: 'ID de anúncio inválido.' };
  const deal = Number(entry?.deal_price);
  if (!(deal > 0)) return { ok: false, item_id: itemId, product_name: entry?.product_name || '', error: 'Preço promocional inválido.' };
  const payload = { promotion_id: promotionId, promotion_type: 'SELLER_CAMPAIGN', deal_price: deal };
  try {
    const r = await mlJson(atual, `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, jsonInit('POST', payload));
    return { ok: true, item_id: itemId, product_name: entry?.product_name || '', listing_type: entry?.listing_type || '', result: r.data };
  } catch (erroPost) {
    // Se o item já estiver na campanha, a API exige PUT. Tentar PUT aqui torna
    // o fluxo em lote idempotente sem obrigar o usuário a saber se já havia aplicado.
    if (![400, 409].includes(Number(erroPost?.status))) {
      return { ok: false, item_id: itemId, product_name: entry?.product_name || '', listing_type: entry?.listing_type || '', error: erroPost.message };
    }
    try {
      const r2 = await mlJson(atual, `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, jsonInit('PUT', payload));
      return { ok: true, item_id: itemId, product_name: entry?.product_name || '', listing_type: entry?.listing_type || '', updated: true, result: r2.data };
    } catch (erroPut) {
      return { ok: false, item_id: itemId, product_name: entry?.product_name || '', listing_type: entry?.listing_type || '', error: `${erroPost.message} / atualização: ${erroPut.message}` };
    }
  }
}

async function processarEmLotes(lista, tamanho, fn) {
  const out = [];
  for (let i = 0; i < lista.length; i += tamanho) {
    out.push(...await Promise.all(lista.slice(i, i + tamanho).map(fn)));
  }
  return out;
}

function validarPeriodo(start, finish) {
  const a = new Date(start);
  const b = new Date(finish);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) throw new HttpError('Datas da campanha inválidas.', 400);
  if (b < a) throw new HttpError('A data final não pode ser anterior à data inicial.', 400);
  if ((b - a) / 86400000 > 14) throw new HttpError('Campanhas do vendedor podem durar no máximo 14 dias.', 400);
}

export default async (req) => {
  try {
    const atual = await sessaoObrigatoria(req);
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const itemId = String(url.searchParams.get('item_id') || '').trim().toUpperCase();
      const promotionId = String(url.searchParams.get('promotion_id') || '').trim();
      if (itemId) {
        if (!itemIdValido(itemId)) throw new HttpError('ID de anúncio inválido.', 400);
        const r = await mlJson(atual, `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`);
        return respostaComSessao(atual, { item_id: itemId, promotions: r.data || [] });
      }
      if (promotionId) {
        const [detail, items] = await Promise.all([
          mlJson(atual, `/seller-promotions/promotions/${encodeURIComponent(promotionId)}?promotion_type=SELLER_CAMPAIGN&app_version=v2`),
          mlJson(atual, `/seller-promotions/promotions/${encodeURIComponent(promotionId)}/items?promotion_type=SELLER_CAMPAIGN&app_version=v2`),
        ]);
        return respostaComSessao(atual, { campaign: detail.data, items: items.data?.results || [], paging: items.data?.paging || null });
      }
      const r = await mlJson(atual, `/seller-promotions/users/${encodeURIComponent(atual.sessao.user_id)}?app_version=v2`);
      return respostaComSessao(atual, { promotions: r.data?.results || [], paging: r.data?.paging || null });
    }

    if (req.method !== 'POST') throw new HttpError('Use GET ou POST.', 405);
    const body = await bodyJson(req);
    const action = String(body.action || '').trim();

    if (action === 'bulk_campaign_items') {
      const promotionId = String(body.promotion_id || '').trim();
      if (!promotionId) throw new HttpError('Selecione uma campanha.', 400);
      const entries = Array.isArray(body.items) ? body.items : [];
      if (!entries.length) throw new HttpError('Nenhum produto foi enviado para a campanha.', 400);
      if (entries.length > 24) throw new HttpError('Envie no máximo 24 anúncios por lote.', 400);
      const results = await processarEmLotes(entries, 6, (entry) => aplicarItemCampanha(atual, promotionId, entry));
      const success = results.filter((x) => x.ok).length;
      return respostaComSessao(atual, { ok: success === results.length, promotion_id: promotionId, processed: results.length, success, failed: results.length - success, results });
    }

    if (action === 'create_campaign') {
      const name = String(body.name || '').trim();
      if (!name) throw new HttpError('Informe o nome da campanha.', 400);
      const start = isoLocalDate(body.start_date, 'a data inicial');
      const finish = isoLocalDate(body.finish_date, 'a data final');
      validarPeriodo(start, finish);
      const payload = { promotion_type: 'SELLER_CAMPAIGN', name, sub_type: 'FLEXIBLE_PERCENTAGE', start_date: start, finish_date: finish };
      const r = await mlJson(atual, '/seller-promotions/promotions?app_version=v2', jsonInit('POST', payload));
      return respostaComSessao(atual, { ok: true, result: r.data });
    }

    if (action === 'update_campaign') {
      const promotionId = String(body.promotion_id || '').trim();
      if (!promotionId) throw new HttpError('Informe a campanha.', 400);
      const payload = { promotion_type: 'SELLER_CAMPAIGN' };
      if (String(body.name || '').trim()) payload.name = String(body.name).trim();
      if (body.start_date) payload.start_date = isoLocalDate(body.start_date, 'a data inicial');
      if (body.finish_date) payload.finish_date = isoLocalDate(body.finish_date, 'a data final');
      if (payload.start_date && payload.finish_date) validarPeriodo(payload.start_date, payload.finish_date);
      const r = await mlJson(atual, `/seller-promotions/promotions/${encodeURIComponent(promotionId)}?app_version=v2`, jsonInit('PUT', payload));
      return respostaComSessao(atual, { ok: true, result: r.data });
    }

    if (action === 'delete_campaign') {
      const promotionId = String(body.promotion_id || '').trim();
      if (!promotionId) throw new HttpError('Informe a campanha.', 400);
      const r = await mlJson(atual, `/seller-promotions/promotions/${encodeURIComponent(promotionId)}?promotion_type=SELLER_CAMPAIGN&app_version=v2`, { method: 'DELETE' });
      return respostaComSessao(atual, { ok: true, result: r.data });
    }

    const itemId = String(body.item_id || '').trim().toUpperCase();
    if (!itemIdValido(itemId)) throw new HttpError('ID de anúncio inválido.', 400);

    if (action === 'price_discount') {
      const deal = Number(body.deal_price);
      const top = body.top_deal_price === '' || body.top_deal_price == null ? null : Number(body.top_deal_price);
      if (!(deal > 0)) throw new HttpError('Informe o preço promocional.', 400);
      const payload = { deal_price: deal, start_date: String(body.start_date || ''), finish_date: String(body.finish_date || ''), promotion_type: 'PRICE_DISCOUNT' };
      if (top && top > 0) payload.top_deal_price = top;
      if (!payload.start_date || !payload.finish_date) throw new HttpError('Informe início e fim do desconto.', 400);
      const r = await mlJson(atual, `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, jsonInit('POST', payload));
      return respostaComSessao(atual, { ok: true, result: r.data });
    }

    if (action === 'remove_price_discount') {
      const r = await mlJson(atual, `/seller-promotions/items/${encodeURIComponent(itemId)}?promotion_type=PRICE_DISCOUNT&app_version=v2`, { method: 'DELETE' });
      return respostaComSessao(atual, { ok: true, result: r.data });
    }

    if (['add_campaign_item', 'update_campaign_item'].includes(action)) {
      const promotionId = String(body.promotion_id || '').trim();
      const deal = Number(body.deal_price);
      const top = body.top_deal_price === '' || body.top_deal_price == null ? null : Number(body.top_deal_price);
      if (!promotionId) throw new HttpError('Selecione uma campanha.', 400);
      if (!(deal > 0)) throw new HttpError('Informe o preço promocional do produto.', 400);
      const payload = { promotion_id: promotionId, promotion_type: 'SELLER_CAMPAIGN', deal_price: deal };
      if (top && top > 0) payload.top_deal_price = top;
      if (body.remove_loyalty === true) payload.remove_loyalty = true;
      const method = action === 'add_campaign_item' ? 'POST' : 'PUT';
      const r = await mlJson(atual, `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`, jsonInit(method, payload));
      return respostaComSessao(atual, { ok: true, result: r.data });
    }

    if (action === 'remove_campaign_item') {
      const promotionId = String(body.promotion_id || '').trim();
      if (!promotionId) throw new HttpError('Selecione uma campanha.', 400);
      const r = await mlJson(atual, `/seller-promotions/items/${encodeURIComponent(itemId)}?promotion_type=SELLER_CAMPAIGN&promotion_id=${encodeURIComponent(promotionId)}&app_version=v2`, { method: 'DELETE' });
      return respostaComSessao(atual, { ok: true, result: r.data });
    }

    throw new HttpError('Ação de promoção inválida.', 400);
  } catch (erro) {
    console.error('Falha em promoções:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/promotions' };
