# Kyvvo

CRM para pequenos negócios — agendamento inteligente via WhatsApp e visualização de agenda no app mobile.

## O que é

Kyvvo é uma plataforma SaaS que permite clientes de salões de beleza (e outros pequenos negócios) agendarem horários diretamente pelo WhatsApp. O dono do negócio visualiza todos os agendamentos no app mobile.

## MVP

Dois épicos:

- **E1 — Agendamento via WhatsApp**: bot conversacional que guia o cliente pelo fluxo de agendamento
- **E2 — App mobile**: visualização da agenda (dia, semana, mês) e perfil do negócio

## Stack

| Camada | Tecnologia |
|---|---|
| Bot / Automação | n8n + Evolution API (WhatsApp Baileys) |
| Backend | Node.js + Fastify + Supabase (PostgreSQL) |
| Mobile | React Native + Expo |
| Infra | Railway |

## Estrutura do repositório

```
kyvvo/
├── docs/               # Documentação do produto
│   ├── mvp-scope.md    # Escopo do MVP
│   ├── epics.md        # Épicos e User Stories
│   └── architecture.md # Arquitetura técnica
├── n8n/                # Fluxos do n8n (JSON)
│   └── whatsapp-bot-v2.json
├── landing/            # Landing page e lista de espera
│   └── index.html
└── README.md
```

## Configuração local

### Pré-requisitos
- Node.js 18+
- Conta no Railway
- Conta no Supabase
- Número de WhatsApp para teste

### Variáveis de ambiente (Evolution API)
```env
SERVER_URL=https://sua-url.railway.app
AUTHENTICATION_TYPE=apikey
AUTHENTICATION_API_KEY=sua-chave
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://...
DATABASE_ENABLED=true
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true
```

### Variáveis de ambiente (n8n)
```env
N8N_HOST=0.0.0.0
N8N_PORT=5678
N8N_PROTOCOL=https
WEBHOOK_URL=https://sua-url.railway.app
N8N_ENCRYPTION_KEY=sua-chave
GENERIC_TIMEZONE=America/Sao_Paulo
```

## Links úteis

- [Evolution API Docs](https://doc.evolution-api.com)
- [n8n Docs](https://docs.n8n.io)
- [Supabase Docs](https://supabase.com/docs)

## Licença

Privado — todos os direitos reservados © 2026 Kyvvo.
