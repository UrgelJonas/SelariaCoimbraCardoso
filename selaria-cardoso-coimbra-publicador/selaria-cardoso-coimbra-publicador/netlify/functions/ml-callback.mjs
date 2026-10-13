// Recebe o vendedor de volta do Mercado Livre, confere o "state" e troca o código por tokens.
import {
  apagarCookie, cookieSessao, iguais, lerCookies, pedirToken, sessaoDoToken, urlDeRetorno,
} from "../lib/sessao.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const estadoSalvo = lerCookies(req).ml_estado;
  const voltar = (erro, cookies = []) => {
    const cabecalhos = new Headers({ location: erro ? "/?erro=" + erro : "/?conectado=1", "cache-control": "no-store" });
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
    return voltar(null, [limpar, cookieSessao(sessaoDoToken(dados))]);
  } catch (erro) {
    console.error("Falha ao trocar o código por token:", erro.status, erro.message);
    return voltar("troca", [limpar]);
  }
};

export const config = { path: "/api/ml/callback" };
