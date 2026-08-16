-- Backfill de clientes.telefone criados pelo portal (POST /api/agendamentos)
-- antes da normalização com DDI (ver normalizarTelefoneCliente em index.js).
-- O bot/IA no WhatsApp sempre salvaram com DDI 55 (formato que a Meta manda
-- em msg.from); o portal salvava sem, quebrando silenciosamente a unique key
-- (tenant_id, telefone) — o mesmo cliente virava dois registros diferentes
-- dependendo de quem criou primeiro. Conferido antes de rodar: nenhum tenant
-- tinha os dois formatos pro mesmo número (sem risco de colisão/merge).
update clientes set telefone = '55' || telefone where length(telefone) in (10, 11);
