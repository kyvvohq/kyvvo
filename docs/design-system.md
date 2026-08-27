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

## Portal admin (2026-08-27)

Primeira área a receber peças do DS além de cor/tipografia/tokens:

- **Ícones do menu lateral** — biblioteca lucide (igual o DS especifica),
  18x18, `currentColor`. Paths embutidos em `server/panel/public/admin/
  shell.js` (`LUCIDE_ICONS`), injetados via `data-icon="..."` em cada
  `<a class="menu-item">`. Sem lib externa — só os ícones usados.
- **Tema claro/escuro** — toggle no topbar (só na área admin; o painel do
  tenant nunca seta `data-theme` e continua sempre escuro). ~260 cores
  fixas de `style.css` (compartilhado com o painel do tenant) viraram
  variáveis com par light/dark; verde/vermelho/âmbar do tema claro são
  tons mais escuros que os do escuro (contraste sobre branco). Aplicado
  antes do paint (script síncrono no `<head>`) pra não piscar o tema
  errado; persistido em `localStorage.kyvvo_admin_tema`.
- **Topbar/rodapé** — viraram cartões (fundo/borda/radius), mesmo
  tratamento visual do DS ("Barra superior"/rodapé "Base"). Não importa o
  rodapé institucional completo do DS (colunas Plataforma/Produtos/
  Empresa/Legal, redes sociais) — não cabe numa ferramenta interna.

Pendente: o resto do painel do tenant (agenda/financeiro/relatórios/
onboarding) ainda não foi tocado — continua com as cores antigas em hex
fixo, sem tema claro disponível (o toggle não aparece lá).

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
