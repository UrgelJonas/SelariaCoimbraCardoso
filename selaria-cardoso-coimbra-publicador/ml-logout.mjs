// Sai da conta: apaga o cookie de sessão deste navegador.
import { apagarCookie, resposta } from "../lib/sessao.mjs";

export default async (req) => {
  if (req.method !== "POST") return resposta({ erro: "Use POST." }, 405);
  return resposta({ connected: false }, 200, [apagarCookie("ml_sessao")]);
};

export const config = { path: "/api/ml/logout" };
