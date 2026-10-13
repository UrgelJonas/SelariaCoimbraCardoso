import { bodyJson, HttpError, itemIdValido, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';

function cleanText(v) {
  return String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordingText(wordings, type) {
  const list = Array.isArray(wordings) ? wordings : [];
  const found = list.find((w) => String(w?.type || '').toUpperCase() === type);
  return cleanText(found?.value || found?.text || '');
}

function collectPerformanceActions(perf) {
  const out = [];
  const seen = new Set();
  const walk = (node, trail = []) => {
    if (!node || typeof node !== 'object') return;
    const status = String(node.status || '').toUpperCase();
    const title = cleanText(node.title || node.label || node.name || node.key || '');
    const mode = String(node.mode || '').toUpperCase();
    const wordings = node.wordings && typeof node.wordings === 'object' ? node.wordings : null;
    let message = '';
    if (Array.isArray(wordings)) {
      message = wordingText(wordings, 'REMEDY') || wordingText(wordings, 'REASON');
    } else if (wordings) {
      message = cleanText(wordings.title || wordings.label || wordings.text || wordings.description || '');
    }
    if ((status === 'PENDING' || mode === 'WARNING' || mode === 'OPPORTUNITY') && (title || message)) {
      const text = [title, message].filter(Boolean).join(' — ');
      const key = text.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ title: title || message, message, status: status || 'PENDING', mode: mode || '', path: trail.filter(Boolean).join(' > ') });
      }
    }
    for (const key of ['buckets', 'rules', 'variables', 'children', 'actions']) {
      if (Array.isArray(node[key])) node[key].forEach((child) => walk(child, [...trail, title]));
    }
  };
  walk(perf, []);
  return out.slice(0, 12);
}

function normalizePerformance(data, entityType, entityId) {
  if (!data || typeof data !== 'object') return null;
  return {
    entity_type: data.entity_type || entityType,
    entity_id: data.entity_id || entityId,
    score: Number.isFinite(Number(data.score)) ? Number(data.score) : null,
    level: data.level || '',
    level_wording: data.level_wording || data.level || '',
    calculated_at: data.calculated_at || null,
    actions: collectPerformanceActions(data),
  };
}

function normalizeCompetition(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    status: data.status || '',
    current_price: Number.isFinite(Number(data.current_price)) ? Number(data.current_price) : null,
    price_to_win: Number.isFinite(Number(data.price_to_win)) ? Number(data.price_to_win) : null,
    currency_id: data.currency_id || 'BRL',
    reason: data.reason || '',
    boosts: (Array.isArray(data.boosts) ? data.boosts : []).map((b) => ({
      id: b?.id || '',
      status: b?.status || '',
      description: cleanText(b?.description || b?.name || ''),
    })),
  };
}

function normalizeModeration(data) {
  const list = Array.isArray(data) ? data : (data ? [data] : []);
  if (!list.length) return null;
  const m = list[0] || {};
  return {
    id: m.id || '',
    name: m.name || '',
    date_created: m.date_created || '',
    reason: wordingText(m.wordings, 'REASON') || cleanText(m.reason || ''),
    remedy: wordingText(m.wordings, 'REMEDY') || cleanText(m.remedy || ''),
    evidences: Array.isArray(m.evidences) ? m.evidences.slice(0, 5) : (Array.isArray(m.evidence) ? m.evidence.slice(0, 5) : []),
  };
}

function moderationLikely(target) {
  if (target?.needs_moderation === true) return true;
  const status = String(target?.status || '').toLowerCase();
  const sub = String(target?.sub_status || target?.substatus || '').toLowerCase();
  const tags = Array.isArray(target?.tags) ? target.tags.map((x) => String(x).toLowerCase()) : [];
  return status === 'under_review' || sub === 'warning' || sub === 'waiting_for_patch' || sub === 'held' || sub === 'pending_documentation' || sub === 'forbidden' || sub === 'picture_downloading_pending' || tags.includes('moderation_penalty') || tags.includes('poor_quality_thumbnail');
}

async function analyzeOne(atual, target) {
  const itemId = String(target?.item_id || '').trim().toUpperCase();
  if (!itemIdValido(itemId)) return { item_id: itemId || null, ok: false, error: 'ID de anúncio inválido.' };

  const userProductId = String(target?.user_product_id || '').trim();
  const entityType = userProductId ? 'USER_PRODUCT' : 'ITEM';
  const entityId = userProductId || itemId;
  const result = { item_id: itemId, user_product_id: userProductId || null, ok: true, performance: null, competition: null, moderation: null, errors: [] };

  try {
    const path = userProductId
      ? `/user-product/${encodeURIComponent(userProductId)}/performance`
      : `/item/${encodeURIComponent(itemId)}/performance`;
    const r = await mlJson(atual, path);
    result.performance = normalizePerformance(r.data, entityType, entityId);
  } catch (e) {
    result.errors.push({ scope: 'performance', status: Number(e?.status) || 0, message: e?.message || 'Falha ao consultar qualidade.' });
  }

  if (target?.catalog_listing === true || target?.catalog === true) {
    try {
      const r = await mlJson(atual, `/items/${encodeURIComponent(itemId)}/price_to_win?version=v2`);
      result.competition = normalizeCompetition(r.data);
    } catch (e) {
      result.errors.push({ scope: 'competition', status: Number(e?.status) || 0, message: e?.message || 'Falha ao consultar competição de catálogo.' });
    }
  }

  if (moderationLikely(target)) {
    try {
      const r = await mlJson(atual, `/moderations/last_moderation/${encodeURIComponent(itemId + '-ITM')}`);
      result.moderation = normalizeModeration(r.data);
    } catch (e) {
      if (![404, 400].includes(Number(e?.status))) {
        result.errors.push({ scope: 'moderation', status: Number(e?.status) || 0, message: e?.message || 'Falha ao consultar moderação.' });
      }
    }
  }

  return result;
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return out;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'Use POST.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const body = await bodyJson(req);
    const action = String(body.action || 'analyze').trim().toLowerCase();
    if (action !== 'analyze') throw new HttpError('Ação de otimização inválida.', 400);
    const targets = Array.isArray(body.targets) ? body.targets.slice(0, 30) : [];
    if (!targets.length) throw new HttpError('Envie pelo menos um produto para analisar.', 400);
    const results = await mapLimit(targets, 5, (target) => analyzeOne(atual, target || {}));
    return respostaComSessao(atual, { ok: true, analyzed: results.length, results, checked_at: new Date().toISOString() });
  } catch (erro) {
    console.error('Falha na central de otimização:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/optimization' };
