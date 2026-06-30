-- =============================================================================
-- Migración 0005 — Bandeja de chats (inbox) para conversaciones reales
--
-- Amplía `conversations` con datos necesarios para la mensajería real por los
-- canales (Unipile): id del chat, handle del contacto, contador de no leídos y
-- marcas de tiempo de entrada/salida. Añade un índice único para no duplicar
-- conversaciones del mismo contacto en un canal.
-- =============================================================================

alter table public.conversations add column if not exists unipile_chat_id   text;
alter table public.conversations add column if not exists contact_handle    text;
alter table public.conversations add column if not exists unread_count      integer not null default 0;
alter table public.conversations add column if not exists last_inbound_at   timestamptz;
alter table public.conversations add column if not exists last_outbound_at  timestamptz;

create index if not exists conversations_chat_idx
  on public.conversations (channel_id, unipile_chat_id);

-- Evita duplicar conversaciones reales del mismo contacto en el mismo canal.
create unique index if not exists conversations_unique_contact
  on public.conversations (organization_id, channel_id, contact_external_id)
  where is_test = false and contact_external_id is not null;
