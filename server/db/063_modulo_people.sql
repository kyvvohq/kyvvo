-- Catálogo do módulo "Kyvvo People" (avaliação comportamental para
-- recrutadores, produto separado — server/panel/routes/auth.js#/api/auth/people/acesso).
-- Ativação por tenant continua manual via admin (PATCH /admin/api/tenants/:id/modulos/:moduloKey),
-- mesmo fluxo dos demais módulos (US65) — esta migration só cria a entrada no catálogo.
insert into modulos (key, nome) values
  ('people', 'Kyvvo People')
on conflict (key) do nothing;
