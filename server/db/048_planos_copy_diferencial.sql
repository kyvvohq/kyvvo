-- US73 — cada plano ganha um texto de diferencial voltado a benefício (não
-- ao meio técnico): `headline_diferencial` (até 5 palavras, some acima do
-- preço) e `frase_beneficio` (frase concreta, abaixo do preço). Populados
-- por `chave` (identificador interno imutável — independe do nome/slug que
-- a US72 renomeia em paralelo).
alter table planos
  add column if not exists headline_diferencial text,
  add column if not exists frase_beneficio text,
  add constraint planos_headline_diferencial_tamanho check (char_length(headline_diferencial) <= 120),
  add constraint planos_frase_beneficio_tamanho check (char_length(frase_beneficio) <= 120);

update planos set
  headline_diferencial = 'Seu número, atendimento guiado',
  frase_beneficio = 'A cliente escolhe o serviço e o horário por listas e botões. Simples, rápido e previsível.'
where chave = 'starter';

update planos set
  headline_diferencial = 'Número pronto, zero configuração',
  frase_beneficio = 'A gente entrega o número já ativo na API oficial. Você só cadastra seus serviços.'
where chave = 'business';

update planos set
  headline_diferencial = 'Seu número, atendimento que conversa',
  frase_beneficio = 'A cliente escreve como fala — "quero cortar amanhã de manhã" — e o bot resolve.'
where chave = 'professional';

update planos set
  headline_diferencial = 'Número pronto, atendimento premium',
  frase_beneficio = 'Sem configuração e com atendimento em linguagem natural. O pacote completo.'
where chave = 'enterprise';
