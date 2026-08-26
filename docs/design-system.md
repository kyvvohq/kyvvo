# Kyvvo Design System

Fonte canônica: arquivo pen.dev "Kyvvo DS" (fundações + biblioteca de
componentes — botões, campos, navegação, status, cartões, tabelas, etc.).
Este documento traduz os tokens desse arquivo pro que existe hoje em código,
e serve de referência pra qualquer tela nova do Studio.

Escopo atual: **Studio** (landing em `server/public-studio/` + painel em
`server/panel/public/`). A landing institucional da plataforma
(`server/public/`, kyvvo.com.br) ainda não migrou — segue com a identidade
antiga (Syne/DM Sans) até termos direção de conteúdo pra ela.

## Tipografia

- Display (títulos, wordmark): **Space Grotesk**
- UI / corpo de texto: **Inter**

Substituem Syne/DM Sans em todo o Studio (landing + painel), aplicado em
2026-08-26. Carregadas via Google Fonts nos `<link>` de cada página; os
tokens `--font-d`/`--font-b` (`shared.css` da landing, `style.css` do
painel) apontam pra elas.

## Cor

O acento de marca já nascia alinhado ao DS antes mesmo dessa adoção formal:
`--accent:#7c5cfc` (`shared.css`/`style.css`) é exatamente o `brand-500` do
DS. Não foi alterado.

Tokens de cor existentes (`--bg`, `--bg2`, `--surface`, `--border`,
`--accent`, `--accent-light`, `--cyan`, `--text`, `--muted`) foram mantidos
como estão — em especial `--muted:#7484a5`, que tem um ajuste de contraste
documentado (auditoria WCAG AA, US49/CA) mais fino que a escala genérica
`text-mid` do DS. Não sobrescrever esse valor sem reconferir contraste.

Novos tokens semânticos do DS, adicionados em `shared.css`/`style.css` pra
uso em telas novas (badges de status, alertas, etc.), sem equivalente antes:

```css
--color-success:#12B76A;
--color-warning:#F79009;
--color-danger:#F04438;
--color-info:#22C7F2;
--color-whatsapp:#25D366;
```

## Espaçamento

Escala de 8pt (com base menor de 4px), adicionada como tokens novos —
conteúdo existente ainda usa valores livres, mas telas novas devem preferir
esses:

```css
--space-1:4px;  --space-2:8px;  --space-3:12px; --space-4:16px;
--space-5:24px; --space-6:32px; --space-7:48px; --space-8:64px;
```

## Radius

```css
--radius-sm:8px; --radius-md:12px; --radius-lg:16px;
--radius-xl:24px; --radius-full:999px;
```

## Componentes

O arquivo pen.dev tem uma biblioteca ampla (botões primário/secundário/
terciário/perigo/WhatsApp em várias variantes e tamanhos, campos de
formulário, checkbox/radio/toggle, navegação lateral — incluindo variantes
"Studio" e "People" — abas, tabelas, cartões de plano, depoimentos, FAQ,
toasts, diálogos, estados vazios, avatares). Isso ainda não foi portado
1:1 pro código — os componentes HTML/CSS atuais do painel e da landing
seguem os padrões visuais (cor/tipografia/radius) mas não foram
recriados a partir do DS peça por peça. Ao construir uma tela nova,
consultar o arquivo pen.dev pra ver se o componente já existe lá antes de
desenhar do zero.

## Fora de escopo por enquanto

- **Kyvvo People** (repo `brbpalves/kyvvo-people`, `people.kyvvo.com.br`):
  o DS já tem um componente "Lateral / People", mas nenhuma adoção foi
  feita no código do People ainda — decisão do Bruno, pendente de mais
  direção.
- **Landing da plataforma** (`server/public/`, kyvvo.com.br): segue com
  Syne/DM Sans até ter copy/conteúdo definido.
