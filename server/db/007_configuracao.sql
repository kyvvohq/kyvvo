-- Kyvvo — configurações do painel (dias de funcionamento + formato de hora)

alter table tenants add column dias_funcionamento jsonb not null default '[1,2,3,4,5,6]';
-- dias_funcionamento: array de inteiros 0=domingo .. 6=sábado. Default: seg-sáb, fechado domingo.

alter table tenants add column formato_hora text not null default '24h'
  check (formato_hora in ('24h', '12h'));
