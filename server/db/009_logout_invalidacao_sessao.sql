-- Kyvvo — invalidação de sessão no logout (ST07.5)

alter table usuarios add column token_version integer not null default 0;
