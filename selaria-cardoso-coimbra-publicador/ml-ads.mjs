import { bodyJson, HttpError, jsonInit, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';

function isoDate(d) { return d.toISOString().slice(0, 10); }
function textoErro(erro) { return String(erro?.details?.message || erro?.details?.error || erro?.message || '').toLowerCase(); }
function diagnosticoAds(erro) {
  const t = textoErro(erro);
  if (Number(erro?.status) === 404 && (t.includes('no permissions found for user_id') || t.includes('permissions'))) return { enabled: false, reason: 'product_not_enabled', message: 'Sua conta ainda não tem o produto Product Ads habilitado no Mercado Livre. Entre no Mercado Livre > Meu perfil > Publicidade e ative/acesse Product Ads. Depois, saia e conecte novamente neste publicador.' };
  if ([401, 403].includes(Number(erro?.status))) return { enabled: false, reason: 'oauth_permission', message: 'A autorização atual não liberou Product Ads. Confirme no DevCenter a permissão “Publicidade de um produto” em leitura e escrita e depois use “Sair da conta” e conecte novamente.' };
  return null;
}
async function contextoAds(atual, wanted = '') {
  let adv;
  try { adv = await mlJson(atual, '/advertising/advertisers?product_id=PADS', { headers: { 'content-type': 'application/json' } }, 1); }
  catch (erro) { const diag = diagnosticoAds(erro); if (diag) return { diag }; throw erro; }
  const advertisers = Array.isArray(adv.data?.advertisers) ? adv.data.advertisers : [];
  if (!advertisers.length) return { diag: { enabled: false, reason: 'no_advertiser', message: 'O Mercado Livre não retornou um advertiser de Product Ads para esta conta. Abra Mercado Livre > Meu perfil > Publicidade, confirme que Product Ads está ativo e reconecte a conta.' }, advertisers };
  const chosen = advertisers.find((a) => String(a.advertiser_id) === String(wanted)) || advertisers[0];
  return { advertisers, chosen };
}
function validarCampanha(body) {
  const name = String(body.name || '').trim();
  const status = String(body.status || 'paused').toLowerCase();
  const strategy = String(body.strategy || 'increase').toLowerCase();
  const budget = Number(body.budget);
  const roas = Number(body.roas_target);
  if (!name) throw new HttpError('Informe o nome da campanha de Product Ads.', 400);
  if (!['active', 'paused'].includes(status)) throw new HttpError('Status inválido para campanha.', 400);
  if (!['profitability', 'increase', 'visibility'].includes(strategy)) throw new HttpError('Estratégia inválida.', 400);
  if (!(budget > 0)) throw new HttpError('Informe um orçamento diário maior que zero.', 400);
  if (!(roas >= 1 && roas <= 35)) throw new HttpError('O ROAS alvo deve ficar entre 1 e 35.', 400);
  return { name, status, budget, strategy, channel: 'marketplace', roas_target: roas };
}
export default async (req) => {
  try {
    const atual = await sessaoObrigatoria(req);
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const ctx = await contextoAds(atual, url.searchParams.get('advertiser_id') || '');
      if (ctx.diag) return respostaComSessao(atual, { ...ctx.diag, advertisers: ctx.advertisers || [] });
      const { advertisers, chosen } = ctx;
      const to = new Date(); const from = new Date(to.getTime() - 29 * 86400000); const dateFrom = isoDate(from); const dateTo = isoDate(to);
      let campaigns = null, campaignsError = null, adGroups = null, adGroupsError = null;
      try { const metrics = 'clicks,prints,ctr,cost,cpc,acos,tacos,roas,cvr,direct_amount,indirect_amount,total_amount,direct_units_quantity,indirect_units_quantity,units_quantity,organic_units_quantity,organic_units_amount,organic_items_quantity'; campaigns = (await mlJson(atual, `/advertising/${encodeURIComponent(chosen.site_id)}/advertisers/${encodeURIComponent(chosen.advertiser_id)}/product_ads/campaigns/search?limit=50&offset=0&date_from=${dateFrom}&date_to=${dateTo}&metrics=${encodeURIComponent(metrics)}&metrics_summary=true`, {}, 2)).data; } catch (erro) { campaignsError = erro.message; }
      try { const metrics = 'CLICKS,PRINTS,COST,CPC,CTR,DIRECT_AMOUNT,INDIRECT_AMOUNT,TOTAL_AMOUNT,DIRECT_UNITS_QUANTITY,INDIRECT_UNITS_QUANTITY,UNITS_QUANTITY,DIRECT_ITEMS_QUANTITY,INDIRECT_ITEMS_QUANTITY,ADVERTISING_ITEMS_QUANTITY,ORGANIC_UNITS_QUANTITY,ORGANIC_UNITS_AMOUNT,ORGANIC_ITEMS_QUANTITY,ACOS,TACOS,SOV,CVR,ROAS'; adGroups = (await mlJson(atual, `/advertising/${encodeURIComponent(chosen.site_id)}/advertisers/${encodeURIComponent(chosen.advertiser_id)}/product_ads/ad_groups/search?date_from=${dateFrom}&date_to=${dateTo}&limit=100&offset=0&sort=desc&sort_by=clicks&metrics=${encodeURIComponent(metrics)}&metrics_summary=true&filters[channel]=marketplace`, {}, 2)).data; } catch (erro) { adGroupsError = erro.message; }
      return respostaComSessao(atual, { enabled: true, advertisers, selected: chosen, campaigns, campaigns_error: campaignsError, ad_groups: adGroups, ad_groups_error: adGroupsError, date_from: dateFrom, date_to: dateTo });
    }
    if (req.method !== 'POST') throw new HttpError('Use GET ou POST.', 405);
    const body = await bodyJson(req); const action = String(body.action || '').trim();
    const ctx = await contextoAds(atual, body.advertiser_id || '');
    if (ctx.diag) throw new HttpError(ctx.diag.message, 403, ctx.diag);
    const chosen = ctx.chosen; const site = encodeURIComponent(chosen.site_id); const adv = encodeURIComponent(chosen.advertiser_id);
    if (action === 'create_campaign') {
      const payload = validarCampanha(body);
      const r = await mlJson(atual, `/marketplace/advertising/${site}/advertisers/${adv}/product_ads/campaigns`, jsonInit('POST', payload), 2);
      return respostaComSessao(atual, { ok: true, result: r.data });
    }
    if (action === 'update_campaign') {
      const campaignId = String(body.campaign_id || '').trim(); if (!campaignId) throw new HttpError('Informe a campanha.', 400);
      const payload = {}; for (const k of ['name','status','strategy']) if (body[k] != null && String(body[k]).trim()) payload[k] = String(body[k]).trim().toLowerCase();
      if (body.budget != null && body.budget !== '') { const n=Number(body.budget); if (!(n>0)) throw new HttpError('Orçamento inválido.',400); payload.budget=n; }
      if (body.roas_target != null && body.roas_target !== '') { const n=Number(body.roas_target); if (!(n>=1&&n<=35)) throw new HttpError('ROAS alvo deve ficar entre 1 e 35.',400); payload.roas_target=n; }
      const r = await mlJson(atual, `/marketplace/advertising/${site}/product_ads/campaigns/${encodeURIComponent(campaignId)}`, jsonInit('PUT', payload), 2);
      return respostaComSessao(atual, { ok: true, result: r.data });
    }
    if (action === 'assign_items') {
      const campaignId = Number(body.campaign_id); if (!Number.isFinite(campaignId)) throw new HttpError('Selecione uma campanha.', 400);
      const ids = (Array.isArray(body.item_ids) ? body.item_ids : String(body.item_ids || '').split(/[\s,;]+/)).map(x=>String(x).trim().toUpperCase()).filter(Boolean);
      if (!ids.length) throw new HttpError('Informe ao menos um ID de anúncio.', 400);
      const search = await mlJson(atual, `/marketplace/advertising/${site}/advertisers/${adv}/product_ads/ad_groups/search?filters[item_ids]=${encodeURIComponent(ids.join(','))}`, {}, 2);
      const groups = Array.isArray(search.data?.results) ? search.data.results : [];
      const groupIds = [...new Set(groups.map(g=>Number(g.id)).filter(Number.isFinite))];
      if (!groupIds.length) throw new HttpError('O Mercado Livre não retornou Ad Groups para esses produtos. Eles podem não estar elegíveis/ativos em Product Ads ainda.', 400, search.data);
      const r = await mlJson(atual, `/marketplace/advertising/${site}/advertisers/${adv}/product_ads/ad_groups`, jsonInit('PUT', { ad_groups: groupIds, status: 'active', campaign_id: campaignId }), 2);
      const mapped = groups.map(g=>({ item_or_family: g.ad_group_external_id, ad_group_id: g.id, campaign_id: g.campaign_id, status: g.status, title: g.title }));
      return respostaComSessao(atual, { ok: true, result: r.data, ad_groups: mapped, requested_item_ids: ids });
    }
    if (action === 'remove_ad_groups') {
      const campaignId = String(body.campaign_id || '').trim(); const groups = (Array.isArray(body.ad_group_ids)?body.ad_group_ids:[]).map(Number).filter(Number.isFinite);
      if (!campaignId || !groups.length) throw new HttpError('Informe campanha e Ad Groups.', 400);
      const r = await mlJson(atual, `/marketplace/advertising/${site}/product_ads/campaigns/${encodeURIComponent(campaignId)}/ad_groups`, { method:'DELETE', headers:{'content-type':'application/json'}, body:JSON.stringify({ad_groups:groups}) }, 2);
      return respostaComSessao(atual, { ok:true, result:r.data });
    }
    throw new HttpError('Ação de Product Ads inválida.', 400);
  } catch (erro) { console.error('Falha em Product Ads:', erro); return respostaErro(erro); }
};
export const config = { path: '/api/ml/ads' };
