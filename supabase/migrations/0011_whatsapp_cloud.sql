-- =============================================================================
-- Migración 0011 — WhatsApp Cloud API (capa oficial) + atribución (CAPI)
--
--   1. Credenciales de Cloud API por canal (cifradas en reposo).
--   2. Tabla de eventos enviados a la Conversions API de Meta (auditoría +
--      idempotencia de la atribución de leads cualificados).
-- =============================================================================

-- --- Credenciales Cloud API en el canal (cifradas con FIELD_ENCRYPTION_KEY) ---
alter table public.channels add column if not exists cloud_phone_number_id text;
alter table public.channels add column if not exists cloud_waba_id          text;
alter table public.channels add column if not exists cloud_token_enc        text;
alter table public.channels add column if not exists cloud_app_secret_enc   text;

create index if not exists channels_cloud_phone_idx
  on public.channels (cloud_phone_number_id);

-- --- Pixel/Dataset para la Conversions API (atribución de leads cualificados) ---
alter table public.integrations add column if not exists meta_pixel_id text;

-- --- Log de eventos de la Conversions API ---
create table if not exists public.meta_capi_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  conversation_id  uuid references public.conversations (id) on delete set null,
  ctwa_clid        text,
  event_name       text not null,           -- 'Lead' | 'Purchase' | ...
  status           text not null default 'sent', -- 'sent' | 'failed'
  response         jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists meta_capi_events_org_idx
  on public.meta_capi_events (organization_id, created_at desc);

-- Evita enviar el mismo evento dos veces para una conversación.
create unique index if not exists meta_capi_events_unique
  on public.meta_capi_events (conversation_id, event_name)
  where conversation_id is not null;

alter table public.meta_capi_events enable row level security;

drop policy if exists "capi_events_select_member" on public.meta_capi_events;
create policy "capi_events_select_member"
  on public.meta_capi_events for select
  using (organization_id in (select public.user_org_ids()));
