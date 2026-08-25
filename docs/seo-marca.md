# SEO e identidade de marca — Kyvvo

Referente à US48 (fortalecer SEO e identidade de marca, reduzir confusão com
marcas parecidas como "kyvoo"/"Kyvo").

## O que já está implementado (landing do Studio, `server/public-studio/` — movida de `server/public/` quando kyvvo.com.br virou a landing da plataforma)

- Metadados: `<title>`, meta description, `robots`, canonical, Open Graph e
  Twitter Card em todas as páginas públicas (`index.html`, `diagnostico.html`,
  `privacidade.html`, `termos.html`).
- `schema.org` `Organization` (JSON-LD) na home — nome, descrição,
  fundação, localização e contato, para ajudar buscadores a associar o
  domínio `kyvvo.com.br` à marca certa.
- Conteúdo "O que é o Kyvvo?" reforçado no FAQ, com a grafia (dois "v") e uma
  frase explícita de que não há relação com marcas de nome parecido.
- `robots.txt` e `sitemap.xml` na raiz da landing.

Pendente de infraestrutura (fora do escopo de código deste repositório):
cadastrar o domínio no Google Search Console / Bing Webmaster Tools e
submeter o sitemap — precisa de acesso às contas de propriedade do domínio,
que não existe neste ambiente.

## Estratégia de páginas por segmento (expansão — Fase 2)

A landing atual comunica os 5 nichos já suportados numa seção única
(`niches-section`): Salão de beleza, Pet Shop, Psicólogo(a), Fisioterapia e
Pilates. Para a expansão (Fase 2, quando novos segmentos entrarem via
cadastro dinâmico — ver US34), a proposta é criar **uma landing page dedicada
por segmento** em vez de depender só da seção genérica da home:

- **URL**: `/para/<segmento>.html` (ex: `/para/salao-de-beleza.html`,
  `/para/petshop.html`) — path dedicado, sem depender de querystring, pra
  cada página ser indexável e linkável de forma independente.
- **Conteúdo por página**: título e H1 com o nome do segmento + "Kyvvo"
  (ex: "Kyvvo para Salões de Beleza — Agenda via WhatsApp"), 2-3
  depoimentos/casos de uso específicos do nicho (quando existirem clientes
  reais), FAQ com as dúvidas mais comuns daquele segmento, mesmo CTA de
  cadastro (`data-panel-path="/cadastro.html"`) com UTM de origem pra medir
  conversão por página no PostHog (US47).
- **Critério de priorização**: criar a página do segmento só depois que ele
  tiver volume real de leads/tenants (evita conteúdo fino/duplicado demais
  sem tráfego pra justificar) — os primeiros candidatos são os 5 nichos já
  no MVP, na ordem em que forem crescendo em número de tenants ativos.
- **Reuso**: `shared.css`/`shared.js`/`partials/header.html`/`footer.html`
  já são compartilhados entre as páginas da landing — as páginas de
  segmento devem seguir o mesmo padrão, sem duplicar layout.

Esta é uma proposta de estrutura para quando a expansão começar — a
criação das páginas em si é trabalho de conteúdo/design, não está incluída
nesta entrega.
