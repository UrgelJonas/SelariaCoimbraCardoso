export function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function roundSellingPrice(value, mode = 'none') {
  if (!Number.isFinite(value) || value <= 0) return value;
  if (mode === 'whole') return Math.ceil(value);
  if (mode === '90' || mode === '99') {
    const cents = mode === '90' ? 0.90 : 0.99;
    const base = Math.floor(value);
    let candidate = base + cents;
    if (candidate + 1e-9 < value) candidate = base + 1 + cents;
    return Math.round(candidate * 100) / 100;
  }
  return Math.ceil(value * 100) / 100;
}

export function solvePrice({
  cost = 0,
  packaging = 0,
  fixed = 0,
  shipping = 0,
  marketplaceFixed = 0,
  taxPct = 0,
  marginPct = 0,
  marketplacePct = 0,
  round = 'none',
} = {}) {
  const base = numberOrZero(cost) + numberOrZero(packaging) + numberOrZero(fixed);
  const pct = (numberOrZero(taxPct) + numberOrZero(marginPct) + numberOrZero(marketplacePct)) / 100;
  if (base <= 0) throw new Error('Informe um preço de custo maior que zero.');
  if (pct >= 1) throw new Error('A soma de imposto, comissão e margem precisa ser menor que 100%.');
  const raw = (base + numberOrZero(shipping) + numberOrZero(marketplaceFixed)) / (1 - pct);
  const price = roundSellingPrice(raw, round);
  return { base, raw, price };
}

export function profitability({
  price = 0,
  cost = 0,
  packaging = 0,
  fixed = 0,
  shipping = 0,
  taxPct = 0,
  saleFeeAmount = 0,
} = {}) {
  const base = numberOrZero(cost) + numberOrZero(packaging) + numberOrZero(fixed);
  const p = numberOrZero(price);
  const taxAmount = p * (numberOrZero(taxPct) / 100);
  const profit = p - base - numberOrZero(shipping) - numberOrZero(saleFeeAmount) - taxAmount;
  const margin = p > 0 ? (profit / p) * 100 : 0;
  const markup = base > 0 ? ((p / base) - 1) * 100 : 0;
  return { base, taxAmount, profit, margin, markup };
}
