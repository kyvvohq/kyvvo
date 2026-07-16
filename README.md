# Kyvvo

CRM multi-tenant para pequenos negócios (MEI/ME) — agendamento via WhatsApp e painel web de gestão.

## O que é

Kyvvo é uma plataforma SaaS que permite que negócios (salões de beleza, petshops, etc.) recebam e organizem agendamentos feitos pelos próprios clientes via WhatsApp. Cada negócio (tenant) tem seu próprio painel web para gerenciar agenda, clientes, serviços, financeiro e assinatura.

## Componentes

- **Bot WhatsApp**: fluxo conversacional em n8n + Evolution API (Baileys), guia o cliente final pelo agendamento.
- **Painel do tenant** (`server/panel/public/`): app web onde o dono do negócio gerencia agenda (dia/semana/mês), clientes, serviços, financeiro, perfil e forma de pagamento da assinatura.
- **Painel admin** (`server/panel/public/admin/`): área interna da Kyvvo para gestão de todos os tenants (busca, detalhe, CRUD).
- **Landing page** (`server/public/`, `landing/`): página pública e lista de espera.

## Stack

| Camada | Tecnologia |
|---|---|
| Bot / Automação | n8n + Evolution API (WhatsApp Baileys) |
| Backend (painel + admin) | Node.js + Fastify + PostgreSQL |
| Pagamentos | Asaas (Pix recorrente + cartão de crédito, tokenização server-side) |
| E-mail transacional | Resend |
| Testes | Playwright |
| Infra | EC2 (Docker Compose) atrás de Cloudflare |
| CI/CD | GitHub Actions (deploy automático em push na `main`) |

## Estrutura do repositório

```
kyvvo/
├── docs/                     # Documentação do produto (escopo, épicos, arquitetura)
├── n8n/                      # Fluxos do bot WhatsApp (JSON)
├── landing/                  # Landing page e lista de espera
├── server/
│   ├── index.js              # Landing page / API pública
│   ├── db/                   # Migrations SQL sequenciais (NNN_descricao.sql)
│   └── panel/
│       ├── index.js          # API do painel (tenant + admin)
│       ├── asaas-service.js  # Integração com o gateway Asaas
│       ├── token-service.js  # Verificação de e-mail / tokens
│       ├── tests/            # Suíte Playwright
│       └── public/
│           ├── (painel do tenant)
│           └── admin/        # Painel admin da Kyvvo
└── .github/workflows/        # Deploy automático pra EC2
```

## Desenvolvimento

### Pré-requisitos
- Node.js 18+
- PostgreSQL
- Número de WhatsApp para teste (Evolution API)

### Rodando os testes (painel)
```bash
cd server/panel
npm install
npx playwright test
```

### Migrations
Aplicadas manualmente em produção, em ordem, via `psql`. Ao criar uma nova, use o próximo número sequencial disponível em `server/db/`.

## Deploy

Deploy automático via GitHub Actions (`.github/workflows/deploy.yml`) a cada push na `main`: copia os arquivos alterados (landing e/ou painel, conforme o path) pra EC2 e reinicia o(s) container(s) via Docker Compose.

## Links úteis

- [Evolution API Docs](https://doc.evolution-api.com)
- [n8n Docs](https://docs.n8n.io)
- [Asaas API Docs](https://docs.asaas.com)

## Licença

Privado — todos os direitos reservados © 2026 Kyvvo.
