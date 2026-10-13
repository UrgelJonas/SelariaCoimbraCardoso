import { HttpError, itemIdValido, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';

function inteiro(v, padrao, min, max) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
}

function chunks(lista, tamanho) {
  const out = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

async function detalharItens(atual, ids) {
  const items = [];
  const warnings = [];

  for (const lote of chunks(ids, 20)) {
    try {
      const bulk = await mlJson(atual, `/items/bulk?ids=${lote.map((id) => encodeURIComponent(id)).join(',')}`);
      const respostas = Array.isArray(bulk.data) ? bulk.data : [];
      for (const entry of respostas) {
        const status = Number(entry?.status_code ?? entry?.code ?? 0);
        const body = entry?.body || null;
        if (status >= 200 && status < 300 && body) items.push(body);
        else warnings.push({ id: entry?.id || body?.id || null, status, message: entry?.message || entry?.error || 'Falha ao consultar item.' });
      }
      continue;
    } catch (erroBulk) {
      // Fallback seguro para não deixar a tela "Meus anúncios" inteira indisponível
      // se o endpoint bulk estiver em migração, bloqueado ou responder parcialmente.
      warnings.push({ type: 'bulk_fallback', message: erroBulk.message });
    }

    for (const id of lote) {
      try {
        const detalhe = await mlJson(atual, `/items/${encodeURIComponent(id)}`);
        if (detalhe.data) items.push(detalhe.data);
      } catch (erroItem) {
        warnings.push({ id, status: erroItem.status || 0, message: erroItem.message });
      }
    }
  }

  return { items, warnings };
}

export default async (req) => {
  if (req.method !== 'GET') return new Response(JSON.stringify({ erro: 'Use GET.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const url = new URL(req.url);
    const itemId = String(url.searchParams.get('item_id') || '').trim().toUpperCase();

    if (itemId) {
      if (!itemIdValido(itemId)) throw new HttpError('ID de anúncio inválido.', 400);
      const detalhe = await mlJson(atual, `/items/${encodeURIComponent(itemId)}`);
      let description = '';
      if (url.searchParams.get('include_description') === '1') {
        try {
          const d = await mlJson(atual, `/items/${encodeURIComponent(itemId)}/description`);
          description = String(d.data?.plain_text || d.data?.text || '');
        } catch (_) {}
      }
      return respostaComSessao(atual, { item: detalhe.data, description });
    }

    const offset = inteiro(url.searchParams.get('offset'), 0, 0, 100000);
    const limit = inteiro(url.searchParams.get('limit'), 100, 1, 100);
    const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
    const listingType = String(url.searchParams.get('listing_type_id') || '').trim().toLowerCase();
    const order = String(url.searchParams.get('orders') || 'last_updated_desc').trim().toLowerCase();
    const ordersPermitidos = new Set(['last_updated_desc', 'last_updated_asc', 'start_time_desc', 'start_time_asc', 'stop_time_desc', 'stop_time_asc', 'available_quantity_desc', 'available_quantity_asc', 'price_desc', 'price_asc']);
    const statusPermitidos = new Set(['active', 'paused', 'closed', 'under_review', 'inactive']);
    const listingPermitidos = new Set(['gold_special', 'gold_pro', 'free']);

    const orderEfetivo = ordersPermitidos.has(order) ? order : 'last_updated_desc';
    let buscaPath = `/users/${encodeURIComponent(atual.sessao.user_id)}/items/search?limit=${limit}&offset=${offset}&orders=${encodeURIComponent(orderEfetivo)}`;
    if (statusPermitidos.has(status)) buscaPath += `&status=${encodeURIComponent(status)}`;

    let busca;
    try {
      busca = await mlJson(atual, buscaPath);
    } catch (erro) {
      if ([401, 403].includes(Number(erro?.status))) {
        throw new HttpError(
          'O Mercado Livre não autorizou a leitura dos seus anúncios. Se você alterou as permissões no DevCenter, use “Sair da conta” e conecte novamente para renovar a autorização. Detalhe: ' + erro.message,
          erro.status,
          erro.details,
        );
      }
      throw erro;
    }

    const ids = Array.isArray(busca.data?.results) ? busca.data.results.filter(itemIdValido) : [];
    const detalhados = ids.length ? await detalharItens(atual, ids) : { items: [], warnings: [] };
    const filtrados = listingPermitidos.has(listingType)
      ? detalhados.items.filter((item) => String(item?.listing_type_id || '').toLowerCase() === listingType)
      : detalhados.items;

    return respostaComSessao(atual, {
      paging: busca.data?.paging || { offset, limit, total: filtrados.length },
      items: filtrados,
      warnings: detalhados.warnings,
      order: orderEfetivo,
    });
  } catch (erro) {
    console.error('Falha ao listar anúncios:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/items' };
