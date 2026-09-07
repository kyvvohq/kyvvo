# kyvvo

Repositório **institucional** da Kyvvo — a página em `kyvvo.com.br`.

Desde 2026-09-07 o produto foi separado em repos próprios:

| Repo | O quê |
|---|---|
| **`kyvvohq/kyvvo`** (este) | landing institucional `kyvvo.com.br` (`server/public/`), publicada via AWS Amplify |
| `kyvvohq/kyvvo-studio` | o produto — painel do tenant + admin + landing `studio.kyvvo.com.br` |
| `kyvvohq/kyvvo-n8n` | workflows n8n (bot WhatsApp) |
| `kyvvohq/kyvvo-design-system` | tokens + componentes compartilhados |
| `kyvvohq/kyvvo-platform` | serviço de auth/sessão/entitlements/billing |
| `kyvvohq/kyvvo-infra` | espelho versionado do docker-compose + nginx da EC2 |
| `kyvvohq/kyvvo-integrations` | pacotes `@kyvvohq/*` (asaas, db-migrate, platform-client) |

O histórico completo do monorepo antigo está preservado aqui e em
`kyvvo-studio` (os dois são descendentes deste repo).

## Conteúdo

```
server/public/      # kyvvo.com.br — HTML/CSS estático, deploy via Amplify
├── index.html
├── favicon.svg
└── robots.txt
landing/index.html  # stub de redirect (GitHub Pages)
```

## Deploy

`server/public/` é publicado pelo **AWS Amplify Hosting** (build config no
console da AWS, observa a branch `main` deste repo). Não há GitHub Actions
aqui — o deploy do Studio vive em `kyvvohq/kyvvo-studio`.
