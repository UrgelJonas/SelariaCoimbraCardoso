// API do portal do CLIENTE (/api/c/<codigo>). O código secreto do link é a única credencial.
// O cliente só consegue: ler o recorte que a Gestão libera para ele, editar as próprias prioridades e deixar recados.
import { HttpError, bodyJson } from "../lib/ml.mjs";
import { resposta } from "../lib/sessao.mjs";
import { adicionarRecado, carregarParaCliente, clienteDoToken, marcarRecadosLidos, salvarSecao } from "../lib/gestao-dados.mjs";
import { diaValido, hojeSP } from "../../public/gestao/calc.mjs";

// Resposta pública: sempre sem cache e sem indexação. Código inválido = 404 genérico, sem pista do motivo.
function respostaCliente(dados, status = 200) {
  const r = resposta(dados, status);
  r.headers.set("x-robots-tag", "noindex, nofollow");
  r.headers.set("referrer-policy", "no-referrer");
  return r;
}
const naoEncontrado = () => respostaCliente({ erro: "Link inválido ou desativado." }, 404);

export default async (req) => {
  try {
    const url = new URL(req.url);
    const [token, sub] = url.pathname.replace(/^\/api\/c\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const metodo = req.method.toUpperCase();

    const clienteId = await clienteDoToken(token);
    if (!clienteId) return naoEncontrado();

    if (metodo !== "GET") {
      // pedidos que alteram dados só vindos do próprio site
      const origem = req.headers.get("origin");
      if (origem && origem !== url.origin) throw new HttpError("Pedido recusado.", 403);
      if (req.headers.get("x-gestao") !== "1") throw new HttpError("Pedido recusado.", 403);
    }

    if (!sub && metodo === "GET") {
      const h = url.searchParams.get("hoje");
      return respostaCliente(await carregarParaCliente(clienteId, h && diaValido(h) ? h : hojeSP()));
    }

    if (sub === "prioridades" && metodo === "PUT") {
      const c = await bodyJson(req);
      const r = await salvarSecao(clienteId, "prioridades", c?.dados, c?.rev, "cliente");
      return respostaCliente({ rev: r.rev, prioridades: r.dados.map((p) => ({
        id: p.id, titulo: p.titulo, detalhe: p.detalhe, contaId: p.contaId, urgencia: p.urgencia, status: p.status, origem: p.origem,
        respostaAnalista: p.respostaAnalista, ordem: p.ordem, criadoEm: p.criadoEm,
      })) });
    }

    if (sub === "recados" && metodo === "POST") {
      const c = await bodyJson(req);
      if (c?.acao === "lidos") { await marcarRecadosLidos(clienteId, "cliente"); return respostaCliente({ ok: true }); }
      const r = await adicionarRecado(clienteId, "cliente", c?.texto);
      return respostaCliente({ recado: { id: r.id, de: r.de, texto: r.texto, em: r.em, lido: r.lido } }, 201);
    }

    return respostaCliente({ erro: "Rota não encontrada." }, 404);
  } catch (erro) {
    const status = Number(erro?.status) || 500;
    if (status >= 500) console.error("Gestão (cliente):", erro?.message);
    // erros de validação voltam com a mensagem; falhas internas, sem detalhes
    return respostaCliente({ erro: status >= 500 ? "Erro interno." : erro.message }, status);
  }
};

export const config = { path: ["/api/c/*"] };
