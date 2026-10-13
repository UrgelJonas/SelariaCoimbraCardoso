import { HttpError, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';

export default async (req) => {
  try {
    if (req.method !== 'GET') throw new HttpError('Use GET.', 405);
    const atual = await sessaoObrigatoria(req);
    const url = new URL(req.url);
    const shipmentId = String(url.searchParams.get('shipment_id') || '').trim();
    if (!/^\d+$/.test(shipmentId)) throw new HttpError('ID de envio inválido.', 400);
    const shipment = await mlJson(atual, `/shipments/${encodeURIComponent(shipmentId)}`, { headers: { 'x-format-new': 'true' } });
    let sla = null;
    let sla_error = null;
    try { sla = (await mlJson(atual, `/shipments/${encodeURIComponent(shipmentId)}/sla`)).data; } catch (e) { sla_error = e.message; }
    return respostaComSessao(atual, { shipment: shipment.data, sla, sla_error });
  } catch (erro) {
    console.error('Falha em envio:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/shipment' };
