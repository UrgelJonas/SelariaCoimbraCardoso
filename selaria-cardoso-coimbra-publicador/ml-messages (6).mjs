import { bodyJson, HttpError, jsonInit, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';
const MLB_AGENT_ID='3037675074';
export default async(req)=>{
  try{
    const atual=await sessaoObrigatoria(req),url=new URL(req.url);
    const pack=String(url.searchParams.get('pack_id')||'').trim();
    if(req.method==='GET'){
      if(!pack)throw new HttpError('Informe o pack_id do pedido.',400);
      const mark=url.searchParams.get('mark_as_read')==='true'?'true':'false';
      const r=await mlJson(atual,`/messages/packs/${encodeURIComponent(pack)}/sellers/${encodeURIComponent(atual.sessao.user_id)}?mark_as_read=${mark}&tag=post_sale`);
      return respostaComSessao(atual,{pack_id:pack,messages:r.data});
    }
    if(req.method!=='POST')throw new HttpError('Use GET ou POST.',405);
    const b=await bodyJson(req),packId=String(b.pack_id||'').trim(),text=String(b.text||'').trim();
    if(!packId||!text)throw new HttpError('Informe o pack e a mensagem.',400);
    const payload={from:{user_id:String(atual.sessao.user_id)},to:{user_id:MLB_AGENT_ID},text,attachments:[]};
    const r=await mlJson(atual,`/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(atual.sessao.user_id)}?tag=post_sale`,jsonInit('POST',payload));
    return respostaComSessao(atual,{ok:true,result:r.data});
  }catch(e){console.error('Falha em mensagens:',e);return respostaErro(e)}
};
export const config={path:'/api/ml/messages'};
