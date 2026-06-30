-- =============================================================================
-- Migración 0004 — Contexto rico del setter + Ajustes de IA + Silenciados
--
-- Amplía setter_configs con todo el contexto del negocio (al estilo SkaleX:
-- promesa, fases del embudo, qué ofrece, prueba social, precios, casos
-- especiales, seguimiento) y los ajustes de comportamiento de la IA (tiempos,
-- horario, no responder a seguidos). Añade tabla de contactos silenciados.
-- =============================================================================

-- --- Contexto del negocio (todo opcional; la IA puede rellenarlo) ---
alter table public.setter_configs add column if not exists promise               text;
alter table public.setter_configs add column if not exists funnel_phases         text;
alter table public.setter_configs add column if not exists conversation_types     text;
alter table public.setter_configs add column if not exists best_practices         text;
alter table public.setter_configs add column if not exists product               text;
alter table public.setter_configs add column if not exists team                  text;
alter table public.setter_configs add column if not exists social_proof          text;
alter table public.setter_configs add column if not exists pricing_links         text;
alter table public.setter_configs add column if not exists special_cases         text;
alter table public.setter_configs add column if not exists followups             text;
alter table public.setter_configs add column if not exists summary               text;

-- --- Ajustes de comportamiento de la IA ---
-- Tiempo aleatorio (segundos) antes de empezar a contestar (simula leer).
alter table public.setter_configs add column if not exists first_reply_min_s     integer not null default 45;
alter table public.setter_configs add column if not exists first_reply_max_s     integer not null default 90;
-- Velocidad de escritura (caracteres por segundo) para el "escribiendo...".
alter table public.setter_configs add column if not exists typing_cps            integer not null default 4;
-- Horario de respuesta (UTC). Fuera de horario, los mensajes esperan.
alter table public.setter_configs add column if not exists active_hours_enabled  boolean not null default false;
alter table public.setter_configs add column if not exists active_hours_start    integer not null default 6;
alter table public.setter_configs add column if not exists active_hours_end      integer not null default 23;
alter table public.setter_configs add column if not exists timezone              text not null default 'Europe/Madrid';
-- Instagram: no responder a cuentas que sigues (contactos personales).
alter table public.setter_configs add column if not exists ignore_followed       boolean not null default false;

-- -----------------------------------------------------------------------------
-- TABLA: silenced_contacts  (la IA nunca responde a estos)
-- -----------------------------------------------------------------------------
create table if not exists public.silenced_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  identifier       text not null,
  created_at       timestamptz not null default now(),
  unique (organization_id, identifier)
);

create index if not exists silenced_org_idx on public.silenced_contacts (organization_id);

alter table public.silenced_contacts enable row level security;

drop policy if exists "silenced_select_member" on public.silenced_contacts;
create policy "silenced_select_member"
  on public.silenced_contacts for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "silenced_all_admin" on public.silenced_contacts;
create policy "silenced_all_admin"
  on public.silenced_contacts for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
