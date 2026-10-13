import { bodyJson, HttpError, jsonInit, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';

export default async (req) => {
  try {
    const atual = await sessaoObrigatoria(req);
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 30)));
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
      const status = String(url.searchParams.get('status') || '').trim();
      const qs = new URLSearchParams({ seller_id: String(atual.sessao.user_id), api_version: '4', limit: String(limit), offset: String(offset), sort_fields: 'date_created', sort_types: 'DESC' });
      if (status) qs.set('status', status);
      const r = await mlJson(atual, `/questions/search?${qs.toString()}`);
      return respostaComSessao(atual, { questions: r.data?.questions || [], total: r.data?.total || 0, limit: r.data?.limit || limit, offset });
    }
    if (req.method !== 'POST') throw new HttpError('Use GET ou POST.', 405);
    const body = await bodyJson(req);
    const questionId = Number(body.question_id);
    const text = String(body.text || '').trim();
    if (!Number.isFinite(questionId) || !text) throw new HttpError('Informe a pergunta e a resposta.', 400);
    if (text.length > 2000) throw new HttpError('A resposta deve ter no máximo 2.000 caracteres.', 400);
    const r = await mlJson(atual, '/answers', jsonInit('POST', { question_id: questionId, text }));
    return respostaComSessao(atual, { ok: true, result: r.data });
  } catch (erro) {
    console.error('Falha em perguntas:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/questions' };
