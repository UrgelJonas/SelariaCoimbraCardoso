// Começa o login: manda o vendedor para a tela de autorização do Mercado Livre.
import { randomBytes } from "node:crypto";
import { credenciais, montarCookie, resposta, urlDeRetorno } from "../lib/sessao.mjs";

export default async (req) => {
  try {
    const { id } = credenciais();
    const estado = randomBytes(16).toString("hex");
    const destino = new URL("https://auth.mercadolivre.com.br/authorization");
    destino.searchParams.set("response_type", "code");
    destino.searchParams.set("client_id", id);
    destino.searchParams.set("redirect_uri", urlDeRetorno(req));
    destino.searchParams.set("state", estado);

    const cabecalhos = new Headers({ location: destino.toString(), "cache-control": "no-store" });
    cabecalhos.append("set-cookie", montarCookie("ml_estado", estado, 600));
    return new Response(null, { status: 302, headers: cabecalhos });
  } catch (erro) {
    console.error("Falha ao iniciar o login:", erro.message);
    return resposta({ erro: erro.message }, 500);
  }
};

export const config = { path: "/api/ml/login" };
