import { bodyJson, itemIdValido, jsonInit, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria, HttpError } from '../lib/ml.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'Use POST.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const body = await bodyJson(req);
    const itemId = String(body.item_id || '').trim().toUpperCase();
    if (!itemIdValido(itemId)) throw new HttpError('ID de anúncio inválido.', 400);

    const payload = {};
    if (body.status !== undefined) {
      const status = String(body.status).toLowerCase();
      if (!['active', 'paused', 'closed'].includes(status)) throw new HttpError('Status inválido.', 400);
      payload.status = status;
    }
    if (body.available_quantity !== undefined && body.available_quantity !== '') {
      const q = Number(body.available_quantity);
      if (!Number.isInteger(q) || q < 0) throw new HttpError('Estoque inválido.', 400);
      payload.available_quantity = q;
    }
    if (body.price !== undefined && body.price !== '') {
      const p = Number(body.price);
      if (!Number.isFinite(p) || p <= 0) throw new HttpError('Preço inválido.', 400);
      payload.price = p;
    }
    if (body.title !== undefined && String(body.title).trim()) payload.title = String(body.title).trim();

    if (body.pictures !== undefined) {
      if (!Array.isArray(body.pictures)) throw new HttpError('A lista de imagens é inválida.', 400);
      const ids = body.pictures.map((x) => String(x && (x.id || x) || '').trim()).filter(Boolean);
      if (!ids.length) throw new HttpError('Mantenha pelo menos uma imagem no anúncio.', 400);
      if (ids.length > 60) throw new HttpError('A quantidade de imagens ultrapassa o limite aceito pelo editor.', 400);
      if (new Set(ids).size !== ids.length) throw new HttpError('Existem imagens duplicadas na lista final.', 400);
      if (ids.some((id) => id.length > 160)) throw new HttpError('ID de imagem inválido.', 400);
      payload.pictures = ids.map((id) => ({ id }));
    }

    if (body.manufacturing_time !== undefined) {
      if (body.manufacturing_time === null || body.manufacturing_time === '') {
        payload.sale_terms = [{ id: 'MANUFACTURING_TIME', value_id: null, value_name: null }];
      } else {
        const dias = Number(body.manufacturing_time);
        if (!Number.isInteger(dias) || dias < 0 || dias > 60) throw new HttpError('O prazo de disponibilidade deve ser um número inteiro entre 0 e 60 dias.', 400);

        const itemAtual = await mlJson(atual, `/items/${encodeURIComponent(itemId)}`);
        const item = itemAtual.data || {};
        const logisticType = String(item?.shipping?.logistic_type || '').toLowerCase();
        if (['fulfillment', 'self_service'].includes(logisticType)) {
          throw new HttpError('Este anúncio usa Full/Flex e não aceita prazo de disponibilidade (MANUFACTURING_TIME).', 400);
        }
        const categoryId = String(item.category_id || '').trim();
        if (!categoryId) throw new HttpError('Não foi possível identificar a categoria deste anúncio.', 400);
        const termos = await mlJson(atual, `/categories/${encodeURIComponent(categoryId)}/sale_terms`);
        const lista = Array.isArray(termos.data) ? termos.data : [];
        const manufacturing = lista.find((t) => String(t?.id || '').toUpperCase() === 'MANUFACTURING_TIME');
        if (!manufacturing) {
          throw new HttpError('A categoria deste anúncio não permite prazo de disponibilidade.', 400);
        }
        payload.sale_terms = [{ id: 'MANUFACTURING_TIME', value_name: `${dias} dias` }];
      }
    }

    if (!Object.keys(payload).length) throw new HttpError('Nenhuma alteração foi informada.', 400);

    const atualizado = await mlJson(atual, `/items/${encodeURIComponent(itemId)}`, jsonInit('PUT', payload));
    return respostaComSessao(atual, { updated: true, item: atualizado.data });
  } catch (erro) {
    console.error('Falha ao atualizar anúncio:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/item-update' };
