import { HttpError } from './ml.mjs';

export function normalizarSku(valor) {
  const sku = String(valor ?? '').trim();
  if (!sku) throw new HttpError('Informe o novo SKU.', 400);
  if (sku.length > 60) throw new HttpError('O SKU deve ter no máximo 60 caracteres.', 400);
  if (!/^[A-Za-z0-9._-]+$/.test(sku)) {
    throw new HttpError('O SKU deve usar somente letras, números, hífen, ponto ou sublinhado.', 400);
  }
  return sku.toUpperCase();
}

export function gtinValido(valor) {
  const gtin = String(valor ?? '').replace(/\D/g, '');
  if (!gtin) return true;
  if (![8, 12, 13, 14].includes(gtin.length)) return false;
  const digitos = gtin.split('').map(Number);
  const verificador = digitos.pop();
  let soma = 0;
  for (let i = 0; i < digitos.length; i += 1) {
    const daDireita = digitos.length - 1 - i;
    soma += digitos[i] * (daDireita % 2 === 0 ? 3 : 1);
  }
  return ((10 - (soma % 10)) % 10) === verificador;
}

export function normalizarGtin(valor) {
  const gtin = String(valor ?? '').replace(/\D/g, '');
  if (!gtin) return '';
  if (!gtinValido(gtin)) throw new HttpError('O EAN/GTIN informado não passou na validação do dígito verificador.', 400);
  return gtin;
}

export function atributosIdentificacao(sku, gtin) {
  const attrs = [{ id: 'SELLER_SKU', value_name: normalizarSku(sku) }];
  const codigo = normalizarGtin(gtin);
  if (codigo) {
    attrs.push({ id: 'GTIN', value_name: codigo });
    // Ao incluir um GTIN, remova um eventual motivo de ausência existente.
    attrs.push({ id: 'EMPTY_GTIN_REASON', value_id: null, value_name: null });
  }
  return attrs;
}
