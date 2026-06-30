-- =============================================================================
-- Migración 0012 — Calendarios/agendamiento + aprendizaje por ejemplos
--
--   1. `winning_examples` y ajustes de calendario en `setter_configs`.
--   2. Tabla `calendars`: calendarios (Google/Outlook) conectados vía Unipile,
--      con reglas de disponibilidad.
--   3. Tabla `appointments`: llamadas agendadas (detectadas por el bot o por el
--      webhook del calendario).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLA: calendars
-- -----------------------------------------------------------------------------
create table if not exists public.calendars (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  user_id             uuid references auth.users (id) on delete set null, -- closer dueño (opcional)
  provider            text not null default 'google',   -- 'google' | 'outlook'
  unipile_account_id  text,
  unipile_calendar_id text,
  name                text,
  status              text not null default 'pending',   -- pending|connected|error|disconnected
  -- { tz, days:[1,2,3,4,5], start:"09:00", end:"18:00", slot_min:30, buffer_min:15, max_per_day:8 }
  availability_rules  jsonb not null default '{}'::jsonb,
  is_default          boolean not null default false,
  last_error          text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  connected_at        timestamptz
);

create index if not exists calendars_org_idx on public.calendars (organization_id);
create unique index if not exists calendars_unipile_idx
  on public.calendars (unipile_account_id) where unipile_account_id is not null;

drop trigger if exists calendars_set_updated_at on public.calendars;
create trigger calendars_set_updated_at
  before update on public.calendars
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- TABLA: appointments
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  conversation_id   uuid references public.conversations (id) on delete cascade,
  calendar_id       uuid references public.calendars (id) on delete set null,
  start_at          timestamptz,
  end_at            timestamptz,
  timezone          text,
  unipile_event_id  text,
  meet_url          text,
  status            text not null default 'scheduled', -- scheduled|cancelled|completed
  detected_by       text not null default 'bot',       -- bot|calendar|manual
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists appointments_org_idx on public.appointments (organization_id);
create index if not exists appointments_conv_idx on public.appointments (conversation_id);
create unique index if not exists appointments_event_idx
  on public.appointments (unipile_event_id) where unipile_event_id is not null;

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.calendars    enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "calendars_select_member" on public.calendars;
create policy "calendars_select_member"
  on public.calendars for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "calendars_all_admin" on public.calendars;
create policy "calendars_all_admin"
  on public.calendars for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists "appointments_select_member" on public.appointments;
create policy "appointments_select_member"
  on public.appointments for select
  using (organization_id in (select public.user_org_ids()));

-- -----------------------------------------------------------------------------
-- setter_configs: aprendizaje + calendario
-- -----------------------------------------------------------------------------
alter table public.setter_configs
  add column if not exists winning_examples  text;          -- conversaciones que funcionaron (few-shot)
alter table public.setter_configs
  add column if not exists calendar_mode     text not null default 'off'; -- off|slots|link
alter table public.setter_configs
  add column if not exists calendar_link     text;          -- enlace de agenda (modo link)
alter table public.setter_configs
  add column if not exists call_duration_min integer not null default 30;
alter table public.setter_configs
  add column if not exists default_calendar_id uuid references public.calendars (id) on delete set null;
