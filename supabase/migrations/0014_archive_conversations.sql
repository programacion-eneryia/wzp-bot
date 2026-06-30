-- =============================================================================
-- Migración 0014 — Archivado de conversaciones
--
-- Al DESCONECTAR un canal ya no queremos ver sus conversaciones en el inbox,
-- pero tampoco borrarlas (se conservan por si se reconecta o para histórico).
-- Marcamos `archived_at` y el inbox las oculta por defecto.
-- =============================================================================

alter table public.conversations
  add column if not exists archived_at timestamptz;

-- Índice parcial: el inbox filtra `archived_at is null` constantemente.
create index if not exists conversations_active_idx
  on public.conversations (organization_id, last_message_at desc)
  where archived_at is null;
