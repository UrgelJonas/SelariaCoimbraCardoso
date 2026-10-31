# Selaria Cardoso Coimbra — Central Mercado Livre v1.1.0

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

## v1.2.0 — Calculadora inteligente Mercado Livre

A calculadora agora pode sugerir/consultar a categoria do produto, buscar as tarifas reais de venda para Clássico (`gold_special`) e Premium (`gold_pro`) e estimar o custo de frete do vendedor pela API do Mercado Livre. Para cotação por dimensões, informe altura, largura, comprimento em centímetros e peso em gramas. A estimativa usa `/sites/MLB/listing_prices` e `/users/{user_id}/shipping_options/free`; o custo final de uma venda pode variar e deve ser conciliado pelo shipment real.

## v1.3.0 — Gestão de clientes (Curva A)

Nova aba amarela **Gestão de clientes** no menu da Central. Ao entrar, o resto da Central some e aparece só a Gestão (botão "← Central Mercado Livre" para voltar).

### O que tem
- **Clientes e contas**: cada cliente tem uma ou mais contas (Mercado Livre, Shopee, TikTok Shop).
- **Tarefas** diárias, semanais e mensais com caixinha OK / **Não OK + por quê**. A lista reinicia sozinha a cada dia, semana (segunda a domingo) e mês; o histórico fica guardado. Já vem com um modelo de tarefas (otimizar imagens, títulos e descrições, fotos, vídeos, Ads, cupons, análise e montagem do Full etc.), editável por cliente.
- **Metas** por cliente e por conta (TACOS, ACoS, ROAS, CPC, faturamento, pedidos, conversão, ticket médio ou meta livre), com semáforo.
- **Ads & TACOS** por dia, semana e mês, por conta, com gráfico, total do período e linha de meta.
- **Prioridades** que o cliente cadastra e você responde/acompanha.
- Extras: diário de ações, produtos no Full (etapas), datas comerciais, recados (conversa com o cliente), notas internas e relatório mensal para imprimir/salvar em PDF.

### Configuração (uma vez)
1. No Netlify, crie a variável **`GESTAO_SENHA`** (mínimo 8 caracteres) — é a senha de entrada na Gestão. Sem ela, a tela de login avisa que falta configurar.
2. `SESSION_SECRET` e as variáveis do Mercado Livre já existentes continuam as mesmas.
3. Faça um novo deploy. Os dados ficam no **Netlify Blobs** (não precisa de banco externo; a dependência `@netlify/blobs` está no `package.json`).

### Link do cliente
Ao cadastrar o cliente, o link já é gerado: `https://SEU-SITE/c/<código>`. Botão **Link do cliente** → copiar, abrir como cliente, gerar novo link (o antigo deixa de funcionar na hora) ou revogar.
- O cliente vê só os dados dele (nunca de outros clientes) e **não vê** notas internas, contato nem observação.
- O olho 👁 em tarefas, metas, diário, Full e datas oculta aquele item do cliente; em Ads, a opção "Mostrar esta conta ao cliente" controla a conta inteira.
- O cliente só **edita as prioridades** e **envia recados**. Tarefas, metas e Ads são editados só por você.

### Como lançar o Ads
- **Lançar dia**: gasto, faturamento total, faturamento de Ads, pedidos, cliques e impressões.
- **Colar da planilha**: cole linhas (data, gasto, fat. total, fat. Ads, pedidos, cliques, impressões) copiadas do Excel/Sheets ou do relatório da Shopee.
- **Importar do Mercado Livre** (contas ML): busca o resumo diário de Product Ads da conta **conectada agora na Central** (máx. 62 dias por vez, o ML guarda ~90 dias). Na primeira vez a conta do cliente é vinculada ao vendedor do ML; se depois você estiver conectado na conta de outro cliente, a importação é recusada para não misturar números.
  - Faturamento de Ads = `total_amount`; faturamento total = `total_amount + organic_units_amount`. **Confira** o TACOS de alguns dias contra o painel do Mercado Ads (o valor informado pelo ML fica guardado como `tacosMl` e aparece ao passar o mouse sobre o TACOS do dia).
  - O ML não separa pedidos de unidades: "pedidos" importados são unidades vendidas.
  - A Shopee não tem importação automática: use lançamento manual ou colar da planilha.

### Como os números são calculados
Semana e mês **somam** os valores do período e recalculam os percentuais (nunca média de percentuais). TACOS = gasto ÷ faturamento total; ACoS = gasto ÷ faturamento de Ads; ROAS = faturamento de Ads ÷ gasto; CPC = gasto ÷ cliques; conversão = pedidos de Ads ÷ cliques.

### Segurança
Login do dono com cookie assinado (HttpOnly, Secure, SameSite=Strict, 14 dias), limite de tentativas, proteção contra pedidos de outro site; código do cliente com 256 bits; o portal usa CSP estrita e não é indexado. Todo texto de cliente é exibido como texto puro (nunca como HTML).

### Testes
`npm test` roda os testes de cálculo, de isolamento entre clientes, de permissões e da importação do ML (com resposta simulada).
