// API do dono da Gestão (/api/gestao/*). Tudo aqui exige o login da Gestão, exceto login e sessão.
import { HttpError, bodyJson, respostaErro } from "../lib/ml.mjs";
import { resposta } from "../lib/sessao.mjs";
import {
  cookieDeLogin, cookieDeSaida, estaLogado, exigirAdmin, limparFalhas, loginBloqueado, registrarFalha, senhaConfere, senhaConfigurada,
} from "../lib/gestao-auth.mjs";
import {
  SECOES_ADMIN, adicionarRecado, carregarCompleto, criarCliente, excluirCliente, gerarToken, idClienteValido, idContaValido,
  lancarAds, lerAds, lerPerfil, lerRegistros, marcarRecadosLidos, registrarTarefa, revogarToken, salvarSecao, visaoGeral,
} from "../lib/gestao-dados.mjs";
import { diaValido, hojeSP, mesValido } from "../../public/gestao/calc.mjs";

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// "hoje" vem do navegador (horário de Brasília) quando informado e válido; senão o servidor calcula.
function hojeDe(url) {
  const h = url.searchParams.get("hoje");
  return h && diaValido(h) ? h : hojeSP();
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const partes = url.pathname.replace(/^\/api\/gestao\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const metodo = req.method.toUpperCase();
    const [raiz, id, sub, sub2] = partes;

    // ----- sem login -----
    if (raiz === "sessao" && metodo === "GET") {
      return resposta({ autenticado: estaLogado(req), configurado: senhaConfigurada() });
    }
    if (raiz === "login" && metodo === "POST") {
      if (!senhaConfigurada()) throw new HttpError("A senha da Gestão ainda não foi criada. No Netlify, cadastre a variável GESTAO_SENHA (mínimo 8 caracteres) e publique de novo.", 503);
      if (await loginBloqueado(req)) throw new HttpError("Muitas tentativas. Aguarde 15 minutos e tente de novo.", 429);
      const corpo = await bodyJson(req);
      if (!senhaConfere(corpo?.senha)) {
        await registrarFalha(req);
        await pausa(500);
        throw new HttpError("Senha incorreta.", 401);
      }
      await limparFalhas(req);
      return resposta({ autenticado: true }, 200, [cookieDeLogin()]);
    }
    if (raiz === "logout" && metodo === "POST") {
      return resposta({ autenticado: false }, 200, [cookieDeSaida()]);
    }

    // ----- daqui para baixo: só logado -----
    exigirAdmin(req);

    if (raiz === "clientes" && !id) {
      if (metodo === "GET") return resposta({ clientes: await visaoGeral(hojeDe(url)) });
      if (metodo === "POST") {
        const novo = await criarCliente(await bodyJson(req));
        return resposta({ id: novo }, 201);
      }
    }

    if (raiz === "clientes" && id) {
      if (!idClienteValido(id)) throw new HttpError("Cliente não encontrado.", 404);

      if (!sub) {
        if (metodo === "GET") {
          const doc = await carregarCompleto(id, hojeDe(url));
          return resposta(doc);
        }
        if (metodo === "DELETE") {
          const corpo = await bodyJson(req);
          await excluirCliente(id, corpo?.confirmarNome);
          return resposta({ ok: true });
        }
      }

      if (sub === "token" && metodo === "POST") {
        const corpo = await bodyJson(req);
        if (corpo?.acao === "revogar") { await revogarToken(id); return resposta({ token: null }); }
        if (corpo?.acao === "gerar") return resposta({ token: await gerarToken(id) });
        throw new HttpError("Ação inválida.", 400);
      }

      if (sub === "registro" && metodo === "POST") {
        const c = await bodyJson(req);
        const reg = await registrarTarefa(id, String(c?.tarefaId || ""), String(c?.periodo || ""), c?.status, c?.motivo);
        return resposta({ registro: reg });
      }

      if (sub === "registros" && metodo === "GET" && sub2) {
        return resposta({ registros: await lerRegistros(id, sub2) });
      }

      if (sub === "ads") {
        if (metodo === "GET") {
          const conta = url.searchParams.get("conta") || "";
          const meses = (url.searchParams.get("meses") || "").split(",").filter(Boolean);
          if (!idContaValido(conta)) throw new HttpError("Conta inválida.", 400);
          if (!meses.length || meses.length > 24 || !meses.every(mesValido)) throw new HttpError("Informe de 1 a 24 meses (AAAA-MM).", 400);
          return resposta({ ads: await lerAds(id, conta, meses) });
        }
        if (metodo === "POST") {
          const c = await bodyJson(req);
          if (!idContaValido(c?.contaId)) throw new HttpError("Conta inválida.", 400);
          return resposta(await lancarAds(id, c.contaId, c?.dias, "manual"));
        }
      }

      if (sub === "recados" && metodo === "POST") {
        const c = await bodyJson(req);
        if (c?.acao === "lidos") { await marcarRecadosLidos(id, "admin"); return resposta({ ok: true }); }
        return resposta({ recado: await adicionarRecado(id, "analista", c?.texto) }, 201);
      }

      if (SECOES_ADMIN.includes(sub) && metodo === "PUT") {
        const c = await bodyJson(req);
        return resposta(await salvarSecao(id, sub, c?.dados, c?.rev, "admin"));
      }

      if (sub === "perfil" && metodo === "GET") return resposta(await lerPerfil(id));
    }

    throw new HttpError("Rota não encontrada.", 404);
  } catch (erro) {
    if (!erro?.status || erro.status >= 500) console.error("Gestão (admin):", erro?.message);
    return respostaErro(erro);
  }
};

export const config = { path: ["/api/gestao", "/api/gestao/*"] };
