import { bodyJson, categoriaValida, HttpError, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';
import { profitability, roundSellingPrice, solvePrice } from '../lib/pricing.mjs';

const LISTINGS = [
  { id: 'gold_special', label: 'Clássico' },
  { id: 'gold_pro', label: 'Premium' },
];

function nonNegative(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(`${label} inválido.`, 400);
  return n;
}

function pct(value, label) {
  const n = nonNegative(value, label);
  if (n >= 100) throw new HttpError(`${label} deve ser menor que 100%.`, 400);
  return n;
}

function integerDimension(value, label) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(`${label} deve ser maior que zero.`, 400);
  return n;
}

function feeRecord(data, listingType) {
  const rows = Array.isArray(data) ? data : [data];
  return rows.find((x) => String(x?.listing_type_id || '') === listingType) || rows[0] || null;
}

async function feeQuote(atual, categoryId, listingType, price) {
  const qs = new URLSearchParams({
    price: String(Math.max(1, Number(price) || 1)),
    category_id: categoryId,
    listing_type_id: listingType,
    currency_id: 'BRL',
  });
  const r = await mlJson(atual, `/sites/MLB/listing_prices?${qs.toString()}`);
  const row = feeRecord(r.data, listingType);
  if (!row) throw new HttpError(`O Mercado Livre não retornou a tarifa do anúncio ${listingType}.`, 422);
  const details = row.sale_fee_details || {};
  const percentage = Number(details.percentage_fee ?? details.meli_percentage_fee ?? 0) || 0;
  const fixedFee = Number(details.fixed_fee ?? 0) || 0;
  const amount = Number(row.sale_fee_amount ?? 0) || 0;
  return {
    percentage,
    fixed_fee: fixedFee,
    sale_fee_amount: amount,
    financing_add_on_fee: Number(details.financing_add_on_fee ?? 0) || 0,
    listing_type_name: row.listing_type_name || listingType,
  };
}

async function shippingQuote(atual, body, listingType, price) {
  if (body.shipping_source === 'none') return { cost: 0, source: 'none', billable_weight: null, discount: null };
  if (body.shipping_source === 'manual') {
    return { cost: nonNegative(body.manual_shipping, 'Frete manual'), source: 'manual', billable_weight: null, discount: null };
  }

  const d = body.dimensions || {};
  const h = integerDimension(d.height_cm, 'Altura');
  const w = integerDimension(d.width_cm, 'Largura');
  const l = integerDimension(d.length_cm, 'Comprimento');
  const grams = integerDimension(d.weight_g, 'Peso em gramas');
  const logisticType = ['drop_off', 'cross_docking', 'fulfillment'].includes(body.logistic_type) ? body.logistic_type : 'drop_off';
  const mode = body.mode === 'me1' ? 'me1' : 'me2';
  const freeShipping = body.free_shipping !== false;
  const qs = new URLSearchParams({
    dimensions: `${h}x${w}x${l},${grams}`,
    verbose: 'true',
    item_price: String(Math.max(1, Number(price) || 1)),
    listing_type_id: listingType,
    mode,
    condition: 'new',
    logistic_type: logisticType,
    free_shipping: freeShipping ? 'true' : 'false',
    category_id: String(body.category_id || '').toUpperCase(),
  });
  const r = await mlJson(atual, `/users/${encodeURIComponent(atual.sessao.user_id)}/shipping_options/free?${qs.toString()}`);
  const coverage = r.data?.coverage?.all_country || {};
  const cost = Number(coverage.list_cost ?? 0) || 0;
  return {
    cost,
    source: 'mercado_livre',
    billable_weight: Number(coverage.billable_weight ?? 0) || null,
    currency_id: coverage.currency_id || 'BRL',
    discount: r.data?.coverage?.discount || null,
  };
}

async function quoteListing(atual, body, listing) {
  const cost = nonNegative(body.cost, 'Preço de custo');
  const packaging = nonNegative(body.packaging, 'Custo da embalagem');
  const fixed = nonNegative(body.fixed, 'Custo fixo');
  const taxPct = pct(body.tax_pct, 'Imposto');
  const marginPct = pct(body.margin_pct, 'Margem líquida');
  if (cost <= 0) throw new HttpError('Informe um preço de custo maior que zero.', 400);
  const round = ['none', '90', '99', 'whole'].includes(body.round) ? body.round : 'none';

  let guess = Math.max(1, solvePrice({ cost, packaging, fixed, taxPct, marginPct, marketplacePct: 18, round: 'none' }).price);
  let fee = null;
  let shipping = null;
  for (let i = 0; i < 5; i += 1) {
    fee = await feeQuote(atual, body.category_id, listing.id, guess);
    shipping = await shippingQuote(atual, body, listing.id, guess);
    const solved = solvePrice({
      cost,
      packaging,
      fixed,
      shipping: shipping.cost,
      marketplaceFixed: fee.fixed_fee,
      taxPct,
      marginPct,
      marketplacePct: fee.percentage,
      round: 'none',
    });
    if (Math.abs(solved.price - guess) < 0.02) {
      guess = solved.price;
      break;
    }
    guess = solved.price;
  }

  let finalPrice = roundSellingPrice(guess, round);
  fee = await feeQuote(atual, body.category_id, listing.id, finalPrice);
  shipping = await shippingQuote(atual, body, listing.id, finalPrice);

  // Recalcula uma vez com os valores finais, importante quando a tarifa fixa muda por faixa de preço.
  const recomputed = solvePrice({
    cost,
    packaging,
    fixed,
    shipping: shipping.cost,
    marketplaceFixed: fee.fixed_fee,
    taxPct,
    marginPct,
    marketplacePct: fee.percentage,
    round,
  });
  if (Math.abs(recomputed.price - finalPrice) >= 0.02) {
    finalPrice = recomputed.price;
    fee = await feeQuote(atual, body.category_id, listing.id, finalPrice);
    shipping = await shippingQuote(atual, body, listing.id, finalPrice);
  }

  const p = profitability({
    price: finalPrice,
    cost,
    packaging,
    fixed,
    shipping: shipping.cost,
    taxPct,
    saleFeeAmount: fee.sale_fee_amount,
  });

  return {
    listing_type_id: listing.id,
    label: listing.label,
    price: finalPrice,
    fee_percentage: fee.percentage,
    fee_fixed: fee.fixed_fee,
    fee_amount: fee.sale_fee_amount,
    financing_add_on_fee: fee.financing_add_on_fee,
    shipping_cost: shipping.cost,
    shipping_source: shipping.source,
    billable_weight: shipping.billable_weight,
    shipping_discount: shipping.discount,
    tax_amount: p.taxAmount,
    profit: p.profit,
    effective_margin: p.margin,
    markup: p.markup,
  };
}

export default async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ erro: 'Use POST.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const body = await bodyJson(req);
    body.category_id = String(body.category_id || '').trim().toUpperCase();
    if (!categoriaValida(body.category_id)) throw new HttpError('Informe ou sugira uma categoria MLB válida.', 400);
    const totalPct = Number(body.tax_pct || 0) + Number(body.margin_pct || 0);
    if (!Number.isFinite(totalPct) || totalPct >= 95) throw new HttpError('Imposto + margem estão altos demais para calcular o preço.', 400);

    const settled = await Promise.allSettled(LISTINGS.map((listing) => quoteListing(atual, body, listing)));
    const quotes = settled.map((r, i) => r.status === 'fulfilled'
      ? r.value
      : { listing_type_id: LISTINGS[i].id, label: LISTINGS[i].label, error: r.reason?.message || 'Não foi possível consultar este tipo de anúncio.' });
    if (quotes.every((q) => q.error)) throw new HttpError(quotes.map((q) => `${q.label}: ${q.error}`).join(' | '), 422);
    return respostaComSessao(atual, { category_id: body.category_id, quotes });
  } catch (erro) {
    console.error('Falha na calculadora ML:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/pricing-quote' };
