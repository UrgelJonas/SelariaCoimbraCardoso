// Importação automática de Ads do Mercado Livre para a Gestão (/api/gestao-ads-ml).
// Usa a conta do Mercado Livre que está conectada na Central (cookie de sessão do hub), pede à API de
// Product Ads o resumo de CADA dia do período e grava como lançamentos da conta do cliente.
//
// Trava de segurança: a conta do cliente fica vinculada ao ID do vendedor no Mercado Livre. Se você
// estiver conectado na conta de OUTRO cliente, a importação é recusada em vez de misturar os números.
import { HttpError, bodyJson, mlJson, respostaErro, sessaoObrigatoria } from "../lib/ml.mjs";
import { resposta } from "../lib/sessao.mjs";
import { exigirAdmin } from "../lib/gestao-auth.mjs";
import { idClienteValido, idContaValido, lancarAds, lerPerfil, mapLimite, vincularContaMl } from "../lib/gestao-dados.mjs";
import { addDias, diaValido, hojeSP } from "../../public/gestao/calc.mjs";

const METRICAS = [
  "clicks", "prints", "cost", "total_amount", "direct_amount", "indirect_amount", "units_quantity", "direct_units_quantity",
  "indirect_units_quantity", "organic_units_amount", "organic_units_quantity", "tacos", "acos",
].join(",");

const MAX_DIAS = 62;
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

function diasEntre(de, ate) {
  const dias = [];
  for (let d = de; d <= ate; d = addDias(d, 1)) dias.push(d);
  return dias;
}

// Se a API não mandar o resumo pronto, soma as campanhas.
export function resumoDaResposta(data) {
  if (data && typeof data.metrics_summary === "object" && data.metrics_summary) return data.metrics_summary;
  const soma = {};
  for (const r of data?.results || []) {
    for (const [k, v] of Object.entries(r.metrics || {})) {
      if (["tacos", "acos", "ctr", "cpc", "cvr", "roas", "sov"].includes(k)) continue; // razões não se somam
      soma[k] = num(soma[k]) + num(v);
    }
  }
  return soma;
}

// Converte o resumo do Mercado Livre no lançamento do dia.
//  - Faturamento de ads = total_amount (vendas diretas + assistidas pelo anúncio)
//  - Faturamento total  = ads + vendas orgânicas (organic_units_amount: "vendas sem publicidade")
//  - TACOS do Mercado Livre é guardado à parte (tacosMl) para você conferir contra o cálculo da Gestão.
export function lancamentoDoResumo(s) {
  const fatAds = num(s.total_amount) || num(s.direct_amount) + num(s.indirect_amount);
  const unidadesAds = num(s.direct_units_quantity) + num(s.indirect_units_quantity) || num(s.units_quantity);
  let tacosMl = num(s.tacos);
  if (tacosMl > 0 && tacosMl <= 1) tacosMl *= 100; // a API pode mandar 0,04 em vez de 4
  return {
    gasto: num(s.cost),
    fatAds,
    fatTotal: fatAds + num(s.organic_units_amount),
    pedidosAds: unidadesAds,
    pedidos: unidadesAds + num(s.organic_units_quantity),
    cliques: num(s.clicks),
    impressoes: num(s.prints),
    ...(tacosMl > 0 ? { tacosMl } : {}),
    fonte: "ml",
  };
}

async function contextoAds(atual, advertiserId = "") {
  let adv;
  try {
    adv = await mlJson(atual, "/advertising/advertisers?product_id=PADS", { headers: { "content-type": "application/json" } }, 1);
  } catch (erro) {
    const t = String(erro?.details?.message || erro?.message || "").toLowerCase();
    if (Number(erro?.status) === 404 || t.includes("permissions")) {
      throw new HttpError("Esta conta do Mercado Livre não tem Product Ads habilitado ou a autorização não inclui publicidade. Ative em Mercado Livre > Meu perfil > Publicidade, depois saia e conecte a conta de novo na Central.", 403);
    }
    throw erro;
  }
  const lista = Array.isArray(adv.data?.advertisers) ? adv.data.advertisers : [];
  if (!lista.length) throw new HttpError("O Mercado Livre não devolveu um anunciante de Product Ads para esta conta.", 404);
  return lista.find((a) => String(a.advertiser_id) === String(advertiserId)) || lista[0];
}

export default async (req) => {
  try {
    if (req.method !== "POST") throw new HttpError("Use POST.", 405);
    exigirAdmin(req);
    const c = await bodyJson(req);

    if (!idClienteValido(c?.clienteId) || !idContaValido(c?.contaId)) throw new HttpError("Cliente ou conta inválidos.", 400);
    if (!diaValido(c?.de) || !diaValido(c?.ate)) throw new HttpError("Informe as datas no formato AAAA-MM-DD.", 400);
    if (c.de > c.ate) throw new HttpError("A data inicial não pode ser depois da final.", 400);
    const hoje = diaValido(c.hoje) ? c.hoje : hojeSP();
    if (c.ate > hoje) throw new HttpError("Não dá para importar dias que ainda não aconteceram.", 400);
    const dias = diasEntre(c.de, c.ate);
    if (dias.length > MAX_DIAS) throw new HttpError(`Importe no máximo ${MAX_DIAS} dias por vez.`, 400);

    const perfil = await lerPerfil(c.clienteId);
    const conta = perfil.dados.contas.find((x) => x.id === c.contaId);
    if (!conta) throw new HttpError("Conta não encontrada neste cliente.", 404);
    if (conta.marketplace !== "ml") throw new HttpError("A importação automática existe só para contas do Mercado Livre.", 400);

    const atual = await sessaoObrigatoria(req);
    const eu = (await mlJson(atual, "/users/me")).data;
    const meuId = String(eu.id);

    if (conta.mlUserId && conta.mlUserId !== meuId) {
      throw new HttpError(`A conta do Mercado Livre conectada agora (${eu.nickname}) não é a conta vinculada a "${conta.nome}". Na Central, saia e conecte a conta correta deste cliente.`, 409);
    }
    if (!conta.mlUserId) {
      if (c.vincular !== true) {
        return resposta({ precisaVincular: true, nickname: eu.nickname, userId: meuId, erro: `Vincular a conta do Mercado Livre "${eu.nickname}" a "${conta.nome}"?` }, 409);
      }
      await vincularContaMl(c.clienteId, c.contaId, meuId);
    }

    const anunciante = await contextoAds(atual, c.advertiserId);
    const site = encodeURIComponent(anunciante.site_id);
    const adv = encodeURIComponent(anunciante.advertiser_id);

    const falhas = [];
    const lancamentos = {};
    await mapLimite(dias, 4, async (dia) => {
      try {
        const caminho = `/advertising/${site}/advertisers/${adv}/product_ads/campaigns/search?limit=50&offset=0&date_from=${dia}&date_to=${dia}&metrics=${encodeURIComponent(METRICAS)}&metrics_summary=true`;
        const r = await mlJson(atual, caminho, {}, 2);
        lancamentos[dia] = lancamentoDoResumo(resumoDaResposta(r.data));
      } catch (erro) {
        falhas.push({ dia, erro: erro?.message || "falha" });
      }
    });

    if (!Object.keys(lancamentos).length) {
      throw new HttpError(falhas[0]?.erro || "O Mercado Livre não devolveu dados para o período.", 502);
    }
    const gravado = await lancarAds(c.clienteId, c.contaId, lancamentos, "ml");
    return resposta({ ok: true, importados: gravado.gravados, falhas, conta: { nickname: eu.nickname, userId: meuId }, anunciante: anunciante.advertiser_id });
  } catch (erro) {
    if (!erro?.status || erro.status >= 500) console.error("Gestão (ads ML):", erro?.message);
    return respostaErro(erro);
  }
};

export const config = { path: "/api/gestao-ads-ml" };
