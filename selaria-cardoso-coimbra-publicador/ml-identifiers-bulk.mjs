import { bodyJson, itemIdValido, jsonInit, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria, HttpError } from '../lib/ml.mjs';
import { atributosIdentificacao, normalizarGtin, normalizarSku } from '../lib/identifiers.mjs';

function inteiroPositivo(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function prepararOperacoes(body) {
  const ops = Array.isArray(body?.operations) ? body.operations : [];
  if (!ops.length) throw new HttpError('Selecione pelo menos um produto ou variação.', 400);
  if (ops.length > 50) throw new HttpError('Atualize no máximo 50 produtos/variações por lote.', 400);

  let totalTargets = 0;
  const normalized = ops.map((op, idx) => {
    const rowId = String(op?.row_id || `linha-${idx + 1}`);
    const sku = normalizarSku(op?.sku);
    const gtin = normalizarGtin(op?.gtin);
    const targets = Array.isArray(op?.targets) ? op.targets : [];
    if (!targets.length) throw new HttpError(`A linha ${idx + 1} não possui anúncios para atualizar.`, 400);
    const seen = new Set();
    const cleanTargets = targets.map((t) => {
      const itemId = String(t?.item_id || '').trim().toUpperCase();
      if (!itemIdValido(itemId)) throw new HttpError(`ID de anúncio inválido na linha ${idx + 1}.`, 400);
      const variationId = t?.variation_id == null || t.variation_id === '' ? null : inteiroPositivo(t.variation_id);
      if (t?.variation_id != null && t.variation_id !== '' && !variationId) throw new HttpError(`ID de variação inválido na linha ${idx + 1}.`, 400);
      const key = `${itemId}:${variationId || ''}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { item_id: itemId, variation_id: variationId };
    }).filter(Boolean);
    totalTargets += cleanTargets.length;
    return { row_id: rowId, sku, gtin, targets: cleanTargets };
  });
  if (totalTargets > 100) throw new HttpError('Este lote possui anúncios demais. Divida a seleção em grupos menores.', 400);
  return normalized;
}

async function atualizarItemSimples(atual, itemId, op) {
  const attrs = atributosIdentificacao(op.sku, op.gtin);
  const resp = await mlJson(atual, `/items/${encodeURIComponent(itemId)}`, jsonInit('PUT', { attributes: attrs }));
  return resp.data;
}

async function atualizarVariacoesDoItem(atual, itemId, entries) {
  const detalhe = await mlJson(atual, `/items/${encodeURIComponent(itemId)}`);
  const item = detalhe.data || {};
  const variacoesAtuais = Array.isArray(item.variations) ? item.variations : [];
  if (!variacoesAtuais.length) throw new HttpError(`O anúncio ${itemId} não possui variações internas.`, 400);

  const porId = new Map(entries.map((entry) => [Number(entry.target.variation_id), entry]));
  for (const id of porId.keys()) {
    if (!variacoesAtuais.some((v) => Number(v?.id) === id)) throw new HttpError(`A variação ${id} não existe mais no anúncio ${itemId}.`, 400);
  }

  const payloadVariations = variacoesAtuais.map((v) => {
    const id = Number(v?.id);
    const entry = porId.get(id);
    if (!entry) return { id };
    return { id, attributes: atributosIdentificacao(entry.op.sku, entry.op.gtin) };
  });
  const resp = await mlJson(atual, `/items/${encodeURIComponent(itemId)}`, jsonInit('PUT', { variations: payloadVariations }));
  return resp.data;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'Use POST.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const body = await bodyJson(req);
    const operations = prepararOperacoes(body);
    const results = [];

    // Agrupa variações do mesmo MLB para que todas sejam alteradas em um único PUT,
    // evitando que uma atualização de variação desfaça outra no mesmo anúncio.
    const variationByItem = new Map();
    const simpleTargets = [];
    for (const op of operations) {
      for (const target of op.targets) {
        if (target.variation_id) {
          if (!variationByItem.has(target.item_id)) variationByItem.set(target.item_id, []);
          variationByItem.get(target.item_id).push({ op, target });
        } else {
          simpleTargets.push({ op, target });
        }
      }
    }

    for (const entry of simpleTargets) {
      try {
        await atualizarItemSimples(atual, entry.target.item_id, entry.op);
        results.push({ row_id: entry.op.row_id, item_id: entry.target.item_id, variation_id: null, ok: true, sku: entry.op.sku, gtin: entry.op.gtin || null });
      } catch (erro) {
        results.push({ row_id: entry.op.row_id, item_id: entry.target.item_id, variation_id: null, ok: false, error: erro.message, status: erro.status || 500 });
      }
    }

    for (const [itemId, entries] of variationByItem.entries()) {
      try {
        await atualizarVariacoesDoItem(atual, itemId, entries);
        for (const entry of entries) {
          results.push({ row_id: entry.op.row_id, item_id: itemId, variation_id: entry.target.variation_id, ok: true, sku: entry.op.sku, gtin: entry.op.gtin || null });
        }
      } catch (erro) {
        for (const entry of entries) {
          results.push({ row_id: entry.op.row_id, item_id: itemId, variation_id: entry.target.variation_id, ok: false, error: erro.message, status: erro.status || 500 });
        }
      }
    }

    const ok = results.filter((r) => r.ok).length;
    const failed = results.length - ok;
    return respostaComSessao(atual, { updated: failed === 0, ok, failed, results });
  } catch (erro) {
    console.error('Falha na atualização em lote de SKU/EAN:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/identifiers-bulk' };
