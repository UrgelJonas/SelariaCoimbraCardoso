// Login do dono da Gestão (você). O cliente não usa isto: ele entra pelo link com código secreto.
//
// - Senha vem da variável GESTAO_SENHA do Netlify (nunca fica no código).
// - Depois do login, um cookie assinado (HMAC) com validade; HttpOnly, Secure e SameSite=Strict.
// - Pedidos que alteram dados exigem o cabeçalho x-gestao: 1 e, se houver Origin, ele tem de ser o do próprio site.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "./ml.mjs";
import { lerCookies } from "./sessao.mjs";
import { apagar, ler, gravar } from "./gestao-store.mjs";

export const COOKIE_ADMIN = "gestao_sessao";
const DURACAO_S = 60 * 60 * 24 * 14; // 14 dias
const MAX_FALHAS = 8;
const JANELA_FALHAS_MS = 15 * 60 * 1000;

function segredo() {
  const s = process.env.SESSION_SECRET || "";
  if (s.length < 32) throw new HttpError("SESSION_SECRET precisa ter pelo menos 32 caracteres no Netlify.", 500);
  return createHash("sha256").update("gestao-admin:" + s).digest();
}

function assinar(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", segredo()).update(corpo).digest("base64url");
  return corpo + "." + mac;
}

function conferir(token) {
  try {
    const [corpo, mac] = String(token || "").split(".");
    if (!corpo || !mac) return null;
    const esperado = createHmac("sha256", segredo()).update(corpo).digest("base64url");
    const a = Buffer.from(mac);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const p = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (!p || p.k !== "gestao-admin" || !(p.exp > Date.now())) return null;
    return p;
  } catch {
    return null;
  }
}

export function cookieDeLogin() {
  const v = assinar({ k: "gestao-admin", exp: Date.now() + DURACAO_S * 1000, n: randomBytes(8).toString("hex") });
  return `${COOKIE_ADMIN}=${v}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${DURACAO_S}`;
}

export function cookieDeSaida() {
  return `${COOKIE_ADMIN}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function senhaConfigurada() {
  return Boolean(process.env.GESTAO_SENHA && process.env.GESTAO_SENHA.length >= 8);
}

export function senhaConfere(digitada) {
  const real = process.env.GESTAO_SENHA || "";
  if (real.length < 8) return false;
  const a = createHash("sha256").update(String(digitada ?? "")).digest();
  const b = createHash("sha256").update(real).digest();
  return timingSafeEqual(a, b);
}

export function estaLogado(req) {
  return Boolean(conferir(lerCookies(req)[COOKIE_ADMIN]));
}

export function exigirAdmin(req) {
  if (!estaLogado(req)) throw new HttpError("Entre com a senha da Gestão.", 401);
  const metodo = req.method.toUpperCase();
  if (metodo !== "GET" && metodo !== "HEAD") {
    if (req.headers.get("x-gestao") !== "1") throw new HttpError("Pedido recusado (cabeçalho de segurança ausente).", 403);
    const origem = req.headers.get("origin");
    if (origem && origem !== new URL(req.url).origin) throw new HttpError("Pedido recusado (origem diferente).", 403);
  }
}

// ---------- limite de tentativas de senha ----------

function ipDe(req) {
  const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "desconhecido";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}
const chaveFalhas = (req) => "login/" + ipDe(req);

export async function loginBloqueado(req) {
  const r = await ler(chaveFalhas(req));
  if (!r) return false;
  if (Date.now() - r.desde > JANELA_FALHAS_MS) return false;
  return r.n >= MAX_FALHAS;
}

export async function registrarFalha(req) {
  const chave = chaveFalhas(req);
  const r = await ler(chave);
  const nova = r && Date.now() - r.desde <= JANELA_FALHAS_MS ? { n: r.n + 1, desde: r.desde } : { n: 1, desde: Date.now() };
  await gravar(chave, nova);
}

export async function limparFalhas(req) {
  await apagar(chaveFalhas(req));
}
