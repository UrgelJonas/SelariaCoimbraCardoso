import { HttpError, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';
export default async (req) => {
  try {
    if (req.method !== 'GET') throw new HttpError('Use GET.',405);
    const atual=await sessaoObrigatoria(req); const url=new URL(req.url); const q=String(url.searchParams.get('q')||'').trim();
    if (q.length<3) throw new HttpError('Digite pelo menos 3 caracteres para sugerir a categoria.',400);
    const r=await mlJson(atual, `/sites/MLB/domain_discovery/search?limit=5&q=${encodeURIComponent(q)}`);
    return respostaComSessao(atual,{results:Array.isArray(r.data)?r.data:[]});
  } catch(e){return respostaErro(e)}
};
export const config={path:'/api/ml/category-suggest'};
