import { mlFetch, lerRespostaMl, mensagemMl, respostaComSessao, respostaErro, sessaoObrigatoria, HttpError } from '../lib/ml.mjs';

const TIPOS = new Set(['image/jpeg', 'image/png']);
const DEZ_MB = 10 * 1024 * 1024;

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'Use POST.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') throw new HttpError('Envie uma foto no campo file.', 400);
    if (!TIPOS.has(file.type)) throw new HttpError('A foto deve ser JPG ou PNG.', 400);
    if (file.size > DEZ_MB) throw new HttpError('A foto ultrapassa 10 MB.', 400);

    const destino = new FormData();
    destino.append('file', file, file.name || 'foto.jpg');
    const r = await mlFetch(atual, '/pictures/items/upload', { method: 'POST', body: destino });
    const dados = await lerRespostaMl(r);
    if (!r.ok) throw new HttpError(mensagemMl(dados, 'O Mercado Livre recusou a foto.'), r.status, dados);
    return respostaComSessao(atual, { id: dados?.id, max_size: dados?.max_size, variations: dados?.variations || [] });
  } catch (erro) {
    console.error('Falha ao subir foto:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/picture-upload' };
