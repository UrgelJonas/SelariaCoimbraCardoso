# Selaria Cardoso Coimbra — Central Mercado Livre v1.1.1

Publicador e central operacional do Mercado Livre com a identidade visual da **Selaria Cardoso Coimbra**.

## Identidade visual

- Base preta e grafite.
- Destaques em dourado.
- Branco para contraste e leitura.
- Logo da Selaria Cardoso Coimbra no cabeçalho e favicon.
- Prefixo automático padrão para SKUs criados manualmente: `SCC-`.
- Rascunhos e IDs recentes usam chaves locais próprias deste projeto.

## Funcionalidades principais

- OAuth com Mercado Livre via Netlify Functions.
- Criação e validação de anúncios.
- User Products / família de produtos.
- Clássico e Premium.
- SKU, EAN/GTIN e motivo oficial de ausência de GTIN.
- Variações de tamanho, cor, polegadas e grade personalizada.
- **Grade de perneira simplificada: PP, P, M, G e GG.**
- Upload e gerenciamento de fotos.
- Meus anúncios agrupados por produto/família.
- Edição de preço, estoque, disponibilidade, pausa e reativação.
- Catálogo e análise de competição.
- Promoções.
- Product Ads.
- Pedidos, mensagens, faturamento e métricas conforme permissões da aplicação.
- Central de otimização com qualidade, catálogo, estoque e moderações.
- Edição em massa de preço, estoque e status.


## Calculadora de preço de venda

A aba **Calculadora** calcula o preço de venda recomendado a partir de:

- preço de custo do produto;
- custo da embalagem;
- custo fixo por venda;
- imposto em percentual;
- margem líquida desejada em percentual.

Fórmula usada:

```text
Preço de venda = (custo + embalagem + custo fixo) / (1 - imposto% - margem líquida%)
```

A tela mostra o preço sugerido, valor do imposto, lucro líquido, margem efetiva e markup. Também permite arredondar para final `,90`, final `,99` ou próximo real inteiro e enviar o preço calculado diretamente para o formulário de criação do anúncio. Os valores ficam salvos localmente no navegador para facilitar o uso recorrente.

> Taxas percentuais do Mercado Livre não são adicionadas automaticamente. Se quiser considerá-las, elas devem ser incorporadas ao percentual informado ou ao custo correspondente.

## Nova função: SKU / EAN em lote

Em **Meus anúncios**, selecione vários produtos e clique em **SKU / EAN em lote**.

A ferramenta:

- agrupa Clássico e Premium da mesma variação;
- identifica cor e tamanho pelos atributos do Mercado Livre quando disponíveis;
- gera o SKU seguindo a regra **NOME DO PRODUTO + COR + TAMANHO**;
- normaliza o SKU em letras maiúsculas, sem acentos e separado por hífens;
- permite corrigir nome, cor e tamanho antes de aplicar;
- mostra SKU atual e novo SKU lado a lado;
- possui filtros de **sem SKU**, **sem GTIN** e **SKU fora do padrão**;
- pode gerar EAN-13 para linhas que não possuem GTIN;
- preserva GTIN existente e não gera outro por cima;
- aplica o mesmo SKU/GTIN ao Clássico e Premium da mesma variação;
- processa as linhas em lotes e continua as demais quando uma falha;
- mostra no final quais foram atualizadas e quais tiveram erro.

Exemplos de SKU:

```text
CINTO-COUNTRY-MARROM-95
PERNEIRA-COUNTRY-PRETO-M
MANTA-BAIXEIRO-VERMELHO
```

### Importante sobre EAN/GTIN

O gerador cria um **EAN-13 com dígito verificador matematicamente válido**, mas isso **não registra o código na GS1**. O Mercado Livre informa que GTIN é um identificador de produto, não um SKU interno, e pode exigir um código oficial dependendo da categoria/marca. Se o código for rejeitado, a ferramenta informa a falha e mantém o processamento dos demais produtos.

## Variáveis de ambiente no Netlify

Cadastre:

- `ML_CLIENT_ID`
- `ML_CLIENT_SECRET`
- `SESSION_SECRET`
- `ML_REDIRECT_URI` (opcional)

A URL de redirect no DevCenter deve ser:

```text
https://SEU-SITE.netlify.app/api/ml/callback
```

## Estrutura para o Netlify

Se a pasta `selaria-cardoso-coimbra-publicador` estiver dentro do repositório:

```text
Base directory: selaria-cardoso-coimbra-publicador
Build command: [vazio]
Publish directory: public
Functions directory: netlify/functions
```

Se os arquivos do projeto estiverem diretamente na raiz do repositório, deixe o Base directory vazio.
