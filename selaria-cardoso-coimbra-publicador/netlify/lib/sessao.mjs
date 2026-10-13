// Sessão do Mercado Livre guardada em um cookie criptografado (AES-256-GCM).
// Nenhum token fica no navegador em texto aberto e não há banco de dados.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const RENOVAR_QUANDO_FALTAR_MS = 60 * 60 * 1000; // o access token vale 6 horas; renova com menos de 1 hora
const SEIS_MESES_S = 60 * 60 * 24 * 180; // validade do refresh token

function chave() {
  const segredo = process.env.SESSION_SECRET || "";
  if (segredo.length < 32) throw new Error("SESSION_SECRET precisa ter pelo menos 32 caracteres.");
  return createHash("sha256").update(segredo).digest();
}

export function selar(objeto) {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([cifra.update(JSON.stringify(objeto), "utf8"), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), dados]).toString("base64url");
}

export function abrir(valor) {
  try {
    const bytes = Buffer.from(String(valor || ""), "base64url");
    if (bytes.length < 29) return null;
    const decifra = createDecipheriv("aes-256-gcm", chave(), bytes.subarray(0, 12));
    decifra.setAuthTag(bytes.subarray(12, 28));
    const texto = Buffer.concat([decifra.update(bytes.subarray(28)), decifra.final()]).toString("utf8");
    const s = JSON.parse(texto);
    return s && s.access_token && s.refresh_token ? s : null;
  } catch {
    return null;
  }
}

export function lerCookies(req) {
  const saida = {};
  (req.headers.get("cookie") || "").split(";").forEach((par) => {
    const i = par.indexOf("=");
    if (i > 0) saida[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  });
  return saida;
}

export function montarCookie(nome, valor, maxAgeSegundos) {
  return `${nome}=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSegundos}`;
}
export const apagarCookie = (nome) => montarCookie(nome, "", 0);
export const cookieSessao = (sessao) => montarCookie("ml_sessao", selar(sessao), SEIS_MESES_S);

export function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function urlDeRetorno(req) {
  return process.env.ML_REDIRECT_URI || new URL(req.url).origin + "/api/ml/callback";
}

export function credenciais() {
  const id = process.env.ML_CLIENT_ID;
  const segredo = process.env.ML_CLIENT_SECRET;
  if (!id || !segredo) throw new Error("Faltam ML_CLIENT_ID e ML_CLIENT_SECRET nas variáveis de ambiente.");
  return { id, segredo };
}

export async function pedirToken(parametros) {
  const { id, segredo } = credenciais();
  const corpo = new URLSearchParams({ client_id: id, client_secret: segredo, ...parametros });
  const resposta = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: corpo,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(dados.message || dados.error || "O Mercado Livre recusou o pedido de token.");
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

export function sessaoDoToken(dados) {
  return {
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    user_id: dados.user_id,
    expires_at: Date.now() + (dados.expires_in || 21600) * 1000,
  };
}

// Devolve { sessao, cookie } ou null quando não há sessão válida.
// "cookie" só vem preenchido quando o token foi renovado e precisa ser regravado.
export async function obterSessao(req) {
  const valor = lerCookies(req).ml_sessao;
  let sessao = valor ? abrir(valor) : null;
  if (!sessao) return null;
  if (Date.now() < sessao.expires_at - RENOVAR_QUANDO_FALTAR_MS) return { sessao, cookie: null };
  try {
    const dados = await pedirToken({ grant_type: "refresh_token", refresh_token: sessao.refresh_token });
    sessao = sessaoDoToken(dados);
    return { sessao, cookie: cookieSessao(sessao) };
  } catch (erro) {
    console.error("Falha ao renovar o token:", erro.status, erro.message);
    return null; // o vendedor precisa conectar a conta de novo
  }
}

export function resposta(dados, status = 200, cookies = []) {
  const cabecalhos = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  cookies.filter(Boolean).forEach((c) => cabecalhos.append("set-cookie", c));
  return new Response(JSON.stringify(dados), { status, headers: cabecalhos });
}
