// Armazenamento da Gestão de Clientes no Netlify Blobs (sem banco externo).
// Cada seção de cada cliente é um "blob" próprio, no formato { rev, dados }.
// O "rev" sobe a cada gravação: se alguém salvar com um rev antigo (aba velha aberta
// no celular, por exemplo), a gravação é recusada em vez de apagar o que mudou.
import { HttpError } from "./ml.mjs";

let storeDeTeste = null;
let storeCache = null;

// Só os testes usam isto, para trocar o Blobs por uma memória local.
export function usarStoreDeTeste(s) {
  storeDeTeste = s;
}

async function bruto() {
  if (storeDeTeste) return storeDeTeste;
  if (!storeCache) {
    const { getStore } = await import("@netlify/blobs");
    storeCache = getStore({ name: "gestao", consistency: "strong" });
  }
  return storeCache;
}

export async function ler(chave) {
  const s = await bruto();
  const v = await s.get(chave, { type: "json" });
  return v ?? null;
}

export async function gravar(chave, valor) {
  const s = await bruto();
  await s.setJSON(chave, valor);
}

export async function apagar(chave) {
  const s = await bruto();
  await s.delete(chave);
}

export async function listar(prefixo) {
  const s = await bruto();
  const saida = [];
  let cursor;
  // O Blobs devolve tudo de uma vez nas versões atuais; o laço cobre paginação futura.
  do {
    const r = await s.list({ prefix: prefixo, ...(cursor ? { cursor } : {}) });
    for (const b of r.blobs || []) saida.push(b.key);
    cursor = r.cursor;
  } while (cursor);
  return saida;
}

// ---------- seções com controle de versão ----------

export async function lerSecao(chave, padrao) {
  const d = await ler(chave);
  if (d && typeof d === "object" && "dados" in d) return { rev: Number(d.rev) || 0, dados: d.dados };
  return { rev: 0, dados: padrao };
}

// revEsperada === undefined/null  -> grava sem conferir (uso interno do servidor)
export async function gravarSecao(chave, dados, revEsperada) {
  const atual = await ler(chave);
  const revAtual = atual && typeof atual === "object" ? Number(atual.rev) || 0 : 0;
  if (revEsperada != null && Number(revEsperada) !== revAtual) {
    throw new HttpError("Estes dados foram alterados em outra tela. Recarregue a página e tente de novo.", 409);
  }
  const novo = { rev: revAtual + 1, dados };
  await gravar(chave, novo);
  return novo.rev;
}

// Chaves
export const chaveSecao = (clienteId, secao) => `clientes/${clienteId}/${secao}`;
export const chaveRegistros = (clienteId, ano) => `clientes/${clienteId}/registros/${ano}`;
export const chaveAds = (clienteId, contaId, mes) => `clientes/${clienteId}/ads/${contaId}/${mes}`;
export const chaveToken = (hash) => `tokens/${hash}`;
export const CHAVE_INDICE = "indice";
