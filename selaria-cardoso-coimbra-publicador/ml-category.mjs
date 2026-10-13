import { categoriaValida, mlJson, respostaComSessao, respostaErro, sessaoObrigatoria } from '../lib/ml.mjs';

export default async (req) => {
  if (req.method !== 'GET') return new Response(JSON.stringify({ erro: 'Use GET.' }), { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } });
  try {
    const atual = await sessaoObrigatoria(req);
    const url = new URL(req.url);
    const categoryId = String(url.searchParams.get('category_id') || '').trim().toUpperCase();
    if (!categoriaValida(categoryId)) throw Object.assign(new Error('Informe uma categoria MLB válida.'), { status: 400 });

    const [categoria, atributos, listingTypes] = await Promise.all([
      mlJson(atual, `/categories/${encodeURIComponent(categoryId)}`),
      mlJson(atual, `/categories/${encodeURIComponent(categoryId)}/attributes`),
      mlJson(atual, `/users/${encodeURIComponent(atual.sessao.user_id)}/available_listing_types?category_id=${encodeURIComponent(categoryId)}`),
    ]);

    const attrs = Array.isArray(atributos.data) ? atributos.data : [];
    const resumo = attrs.map((a) => ({
      id: a.id,
      name: a.name,
      value_type: a.value_type,
      value_max_length: a.value_max_length ?? null,
      values: Array.isArray(a.values) ? a.values.slice(0, 500).map((v) => ({ id: v.id ?? null, name: v.name })) : [],
      tags: a.tags || {},
      hierarchy: a.hierarchy || null,
      attribute_group_id: a.attribute_group_id || null,
      attribute_group_name: a.attribute_group_name || null,
    }));

    const especiais = new Set(['GTIN', 'EMPTY_GTIN_REASON', 'SELLER_SKU', 'MPN']);
    const editavel = (a) => a.tags?.read_only !== true && a.tags?.hidden !== true;
    const variacao = resumo.filter((a) => (a.tags?.allow_variations === true || a.hierarchy === 'CHILD_PK') && editavel(a) && !especiais.has(a.id));
    const variacaoAtributos = resumo.filter((a) => a.tags?.variation_attribute === true && a.tags?.read_only !== true);
    const childPk = resumo.filter((a) => a.hierarchy === 'CHILD_PK' && editavel(a));
    const parentPk = resumo.filter((a) => a.hierarchy === 'PARENT_PK' && editavel(a));
    const obrigatorios = resumo.filter((a) => (a.tags?.required === true || a.tags?.new_required === true || a.tags?.conditional_required === true || a.tags?.catalog_required === true) && a.tags?.read_only !== true);
    const gtin = resumo.find((a) => a.id === 'GTIN') || null;
    const emptyGtin = resumo.find((a) => a.id === 'EMPTY_GTIN_REASON') || null;

    return respostaComSessao(atual, {
      category: {
        id: categoria.data?.id || categoryId,
        name: categoria.data?.name || '',
        path_from_root: categoria.data?.path_from_root || [],
        max_variations_allowed: categoria.data?.settings?.max_variations_allowed ?? categoria.data?.max_variations_allowed ?? null,
        max_pictures_per_item: categoria.data?.settings?.max_pictures_per_item ?? categoria.data?.max_pictures_per_item ?? null,
        max_pictures_per_item_var: categoria.data?.settings?.max_pictures_per_item_var ?? categoria.data?.max_pictures_per_item_var ?? null,
        listing_allowed: categoria.data?.settings?.listing_allowed ?? null,
      },
      attributes: resumo,
      variation_attributes: variacao,
      variation_specific_attributes: variacaoAtributos,
      child_pk_attributes: childPk,
      parent_pk_attributes: parentPk,
      required_attributes: obrigatorios,
      gtin,
      empty_gtin_reason: emptyGtin,
      listing_types: listingTypes.data?.available || [],
    });
  } catch (erro) {
    console.error('Falha ao consultar categoria:', erro);
    return respostaErro(erro);
  }
};

export const config = { path: '/api/ml/category' };
