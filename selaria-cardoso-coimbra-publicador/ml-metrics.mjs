import { mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';

export default async (req) => {
  if (req.method !== 'GET') return new Response(JSON.stringify({ erro: 'Use GET.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const url = new URL(req.url);
    const last = Math.min(150, Math.max(1, Number.parseInt(url.searchParams.get('last') || '30', 10) || 30));
    const r = await mlJson(atual, `/users/${encodeURIComponent(atual.sessao.user_id)}/items_visits/time_window?last=${last}&unit=day`);
    return respostaComSessao(atual, { metrics: r.data });
  } catch (erro) {
    console.error('Falha em métricas:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/metrics' };
