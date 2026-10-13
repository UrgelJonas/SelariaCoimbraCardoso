// Diz se há uma conta conectada e quem é. Nunca devolve tokens.
import { obterSessao, resposta } from "../lib/sessao.mjs";

export default async (req) => {
  try {
    const atual = await obterSessao(req);
    if (!atual) return resposta({ connected: false });

    const r = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { authorization: "Bearer " + atual.sessao.access_token, accept: "application/json" },
    });
    if (!r.ok) return resposta({ connected: false }, 200, [atual.cookie]);

    const eu = await r.json();
    return resposta({ connected: true, nickname: eu.nickname, user_id: eu.id, site_id: eu.site_id, tags: Array.isArray(eu.tags) ? eu.tags : [], user_product_seller: Array.isArray(eu.tags) && eu.tags.includes('user_product_seller') }, 200, [atual.cookie]);
  } catch (erro) {
    console.error("Falha ao consultar a conta:", erro.message);
    return resposta({ connected: false, erro: "interno" }, 500);
  }
};

export const config = { path: "/api/ml/me" };
