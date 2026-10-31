// Modelo padrão de tarefas copiado para cada cliente novo. Depois de copiado, cada cliente
// tem a sua própria lista (você edita, apaga e acrescenta por cliente, sem afetar os outros).
import { novoId } from "./gestao-validar.mjs";

const D = "diaria", S = "semanal", M = "mensal";

export const MODELO_TAREFAS = [
  // diárias
  [D, "Ads", "Conferir TACOS, CPC e orçamento das campanhas"],
  [D, "Ads", "Lançar gasto e faturamento do dia na Gestão"],
  [D, "Operação", "Checar estoque dos anúncios que mais vendem"],
  // semanais
  [S, "Anúncios", "Otimizar imagens (lote da semana)"],
  [S, "Anúncios", "Otimizar títulos (SEO)"],
  [S, "Anúncios", "Otimizar descrições"],
  [S, "Conteúdo", "Tirar fotos de produtos"],
  [S, "Conteúdo", "Gravar vídeos"],
  [S, "Conteúdo", "Editar vídeos"],
  [S, "Ads", "Ajustar campanhas e lances (revisão da semana)"],
  [S, "Promoções", "Criar ou ajustar cupons de desconto"],
  [S, "Anúncios", "Criar kits para subir o ticket médio"],
  [S, "Full", "Analisar produtos candidatos ao Full"],
  [S, "Resultados", "Fechar a semana: conferir TACOS semanal e metas"],
  // mensais
  [M, "Full", "Montar e enviar remessa para o Full"],
  [M, "Resultados", "Revisar metas do mês e definir as do próximo"],
  [M, "Resultados", "Gerar relatório mensal para o cliente"],
  [M, "Planejamento", "Preparar datas comerciais do próximo mês"],
  [M, "Anúncios", "Auditoria de anúncios (qualidade, ruptura e pausados)"],
];

export function tarefasDoModelo() {
  return MODELO_TAREFAS.map(([frequencia, categoria, titulo], ordem) => ({
    id: novoId(),
    titulo,
    frequencia,
    categoria,
    contaId: null,
    ativo: true,
    oculto: false,
    ordem,
  }));
}
