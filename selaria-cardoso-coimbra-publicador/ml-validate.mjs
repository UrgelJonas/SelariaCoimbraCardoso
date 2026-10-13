import {
  analisarValidacaoMl,
  bodyJson,
  jsonInit,
  mlFetch,
  lerRespostaMl,
  mensagemMl,
  respostaComSessao,
  respostaErro,
  sessaoObrigatoria,
  HttpError,
  normalizarItemPayload,
  traduzirAvisoMl,
} from '../lib/ml.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'Use POST.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const body = await bodyJson(req);
    if (!body?.item || typeof body.item !== 'object') throw new HttpError('Envie o anúncio em item.', 400);
    const itemNormalizado = normalizarItemPayload(body.item);
    const r = await mlFetch(atual, '/items/validate', jsonInit('POST', itemNormalizado));
    const dados = await lerRespostaMl(r);

    if (!r.ok) {
      const analise = analisarValidacaoMl(dados);
      // O /items/validate pode responder HTTP 400 mesmo quando todas as causas
      // são warnings informativos. Esses avisos não bloqueiam a publicação.
      if (analise.warnings.length && !analise.errors.length) {
        return respostaComSessao(atual, {
          valid: true,
          warnings: analise.warnings.map(traduzirAvisoMl),
          warning_details: analise.warnings,
          response: dados,
        });
      }
      throw new HttpError(mensagemMl(dados, 'O anúncio não passou na validação do Mercado Livre.'), r.status, dados);
    }

    const analise = analisarValidacaoMl(dados);
    return respostaComSessao(atual, {
      valid: true,
      warnings: analise.warnings.map(traduzirAvisoMl),
      warning_details: analise.warnings,
      response: dados,
    });
  } catch (erro) {
    console.error('Falha ao validar anúncio:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/validate' };
