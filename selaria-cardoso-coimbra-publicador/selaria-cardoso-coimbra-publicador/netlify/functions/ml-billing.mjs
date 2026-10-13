import { HttpError, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';
export default async(req)=>{
  try{
    if(req.method!=='GET')throw new HttpError('Use GET.',405);
    const atual=await sessaoObrigatoria(req),url=new URL(req.url),group=String(url.searchParams.get('group')||'ML').toUpperCase(),documentType=String(url.searchParams.get('document_type')||'BILL').toUpperCase(),key=String(url.searchParams.get('key')||'').trim();
    if(!['ML','MP'].includes(group))throw new HttpError('Grupo de faturamento inválido.',400);
    if(!['BILL','CREDIT_NOTE'].includes(documentType))throw new HttpError('Tipo de documento inválido.',400);
    if(key){const r=await mlJson(atual,`/billing/integration/periods/key/${encodeURIComponent(key)}/summary/details?group=${encodeURIComponent(group)}`);return respostaComSessao(atual,{summary:r.data,key,group});}
    const r=await mlJson(atual,`/billing/integration/monthly/periods?group=${encodeURIComponent(group)}&document_type=${encodeURIComponent(documentType)}&offset=0&limit=6`);
    return respostaComSessao(atual,{periods:r.data?.results||[],paging:{offset:r.data?.offset,total:r.data?.total,limit:r.data?.limit},group,document_type:documentType});
  }catch(e){console.error('Falha em faturamento:',e);return respostaErro(e)}
};
export const config={path:'/api/ml/billing'};
