-- =============================================================================
-- Migración 0018 — Sincronización bidireccional con GoHighLevel (GHL)
--
--   Monta el flujo:
--     1. Lead entra desde GHL → CRM setter (ya existía).
--     2. El setter DEVUELVE a GHL un webhook de salida con el `setter_id` (el UUID
--        de la conversación) para que GHL lo guarde en un campo del contacto.
--     3. El bot conversa y envía el calendario (config, modo enlace).
--     4. Si el lead agenda en GHL, GHL nos avisa por webhook → registramos la cita
--        y PAUSAMOS los seguimientos (`followups_paused`).
--
--   Cambios:
--     - `conversations.ghl_contact_id`   : id del contacto en GHL (para responderle).
--     - `conversations.followups_paused` : true = no perseguir más (ya agendó).
--     - `appointments.external_event_id` : id de la cita en el sistema externo (GHL).
--     - `integrations.ghl_webhook_url`   : URL del Inbound Webhook de GHL (salida).
--     - `outbound_events`                : auditoría/idempotencia de webhooks de salida.
-- =============================================================================

-- 1) Conversations: id de contacto GHL + flag de seguimientos --------------------
alter table public.conversations
  add column if not exists ghl_contact_id   text,
  add column if not exists followups_paused boolean not null default false;

create index if not exists conversations_ghl_contact_idx
  on public.conversations (organization_id, ghl_contact_id)
  where ghl_contact_id is not null;

-- 2) Appointments: id de evento externo (GHL) para idempotencia -----------------
alter table public.appointments
  add column if not exists external_event_id text;

create unique index if not exists appointments_external_event_idx
  on public.appointments (organization_id, external_event_id)
  where external_event_id is not null;

-- 3) Integrations: URL del Inbound Webhook de GHL (destino de salida) -----------
alter table public.integrations
  add column if not exists ghl_webhook_url text;

-- 4) Auditoría de webhooks de SALIDA (a GHL u otros) ---------------------------
create table if not exists public.outbound_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid references public.conversations (id) on delete set null,
  kind             text not null,                 -- p.ej. 'ghl_lead_registered'
  target_url       text,
  status           text not null default 'sent',  -- sent | failed
  request          jsonb,
  response         jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists outbound_events_org_idx
  on public.outbound_events (organization_id, created_at desc);

-- Idempotencia: un mismo evento (kind) por conversación no se reenvía.
create unique index if not exists outbound_events_dedupe_idx
  on public.outbound_events (conversation_id, kind)
  where conversation_id is not null;

alter table public.outbound_events enable row level security;

drop policy if exists "outbound_events_select_member" on public.outbound_events;
create policy "outbound_events_select_member"
  on public.outbound_events for select
  using (organization_id in (select public.user_org_ids()));
