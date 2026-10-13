import { HttpError, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';
export default async (req)=>{
  try{
    if(req.method!=='GET')throw new HttpError('Use GET.',405);
    const atual=await sessaoObrigatoria(req),url=new URL(req.url),limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit')||30))),offset=Math.max(0,Number(url.searchParams.get('offset')||0)),status=String(url.searchParams.get('status')||'').trim();
    const qs=new URLSearchParams({seller:String(atual.sessao.user_id),sort:'date_desc',limit:String(limit),offset:String(offset)});if(status)qs.set('order.status',status);
    const r=await mlJson(atual,`/orders/search?${qs.toString()}`);
    return respostaComSessao(atual,{orders:r.data?.results||[],paging:r.data?.paging||null});
  }catch(e){console.error('Falha em pedidos:',e);return respostaErro(e)}
};
export const config={path:'/api/ml/orders'};
