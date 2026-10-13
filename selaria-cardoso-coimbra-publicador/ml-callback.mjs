// Recebe o vendedor de volta do Mercado Livre, confere o "state" e troca o código por tokens.
// v1.1.1: no sucesso envia apenas o cookie de sessão. O cookie temporário de state
// expira sozinho em 10 minutos, evitando respostas com múltiplos Set-Cookie no redirect.
import {
  apagarCookie, cookieSessao, iguais, lerCookies, pedirToken, sessaoDoToken, urlDeRetorno,
} from "../lib/sessao.mjs";

const CODIGOS_OAUTH_SEGUROS = new Set([
  "invalid_client", "invalid_grant", "invalid_request", "unauthorized_client",
  "unauthorized_application", "invalid_scope", "forbidden",
]);

export default async (req) => {
  const url = new URL(req.url);
  const estadoSalvo = lerCookies(req).ml_estado;
  const voltar = (erro, cookies = [], codigo = "") => {
    const qs = new URLSearchParams();
    if (erro) qs.set("erro", erro);
    else qs.set("conectado", "1");
    if (codigo && CODIGOS_OAUTH_SEGUROS.has(codigo)) qs.set("codigo", codigo);
    const cabecalhos = new Headers({ location: "/?" + qs.toString(), "cache-control": "no-store" });
    cookies.forEach((c) => cabecalhos.append("set-cookie", c));
    return new Response(null, { status: 302, headers: cabecalhos });
  };
  const limpar = apagarCookie("ml_estado");

  if (url.searchParams.get("error")) return voltar("negado", [limpar]);

  const estado = url.searchParams.get("state");
  const codigo = url.searchParams.get("code");
  if (!estado || !estadoSalvo || !iguais(estado, estadoSalvo)) return voltar("estado", [limpar]);
  if (!codigo) return voltar("codigo", [limpar]);

  try {
    const dados = await pedirToken({ grant_type: "authorization_code", code: codigo, redirect_uri: urlDeRetorno(req) });
    // Importante: apenas um Set-Cookie nesta resposta. O ml_estado expira sozinho.
    return voltar(null, [cookieSessao(sessaoDoToken(dados))]);
  } catch (erro) {
    console.error("Falha ao trocar o código por token:", erro.status, erro.oauth_code || "", erro.message);
    return voltar("troca", [limpar], erro.oauth_code || "");
  }
};

export const config = { path: "/api/ml/callback" };
