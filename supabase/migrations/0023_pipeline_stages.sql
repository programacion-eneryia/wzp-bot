-- =============================================================================
-- Migración 0023 — Stages (etapas del pipeline) EDITABLES por organización
--
--   Hasta ahora las etapas eran un enum fijo (`funnel_stage`) con 7 valores en
--   inglés que el cliente no podía tocar. A partir de aquí:
--     - `pipeline_stages`: catálogo de etapas por organización (nombre, color,
--       orden). Cada etapa tiene una `key` estable que es lo que se guarda en
--       `conversations.stage` / `leads.status` / `tag_definitions.set_stage`.
--     - Las 7 etapas históricas + la nueva `calendar_sent` ("Calendario
--       enviado": el bot ha mandado el enlace de agenda, pero la cita aún no
--       está confirmada) se siembran como etapas "de sistema": se pueden
--       renombrar, recolorear y reordenar, pero no borrar (el código las usa
--       para estadísticas, webhooks de cita, etc.). Las etapas que cree el
--       cliente son libres.
--     - `conversations.stage` y `tag_definitions.set_stage` pasan de enum a
--       text para admitir claves nuevas.
-- =============================================================================

-- 1) Catálogo ------------------------------------------------------------------
create table if not exists public.pipeline_stages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Clave estable (slug) que se guarda en conversations.stage / leads.status.
  key              text not null,
  name             text not null,
  color            text not null default '#6366f1',
  sort_order       int  not null default 0,
  -- Etapas de sistema: el código depende de su `key`; no se pueden borrar.
  is_system        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists pipeline_stages_org_key_uq
  on public.pipeline_stages (organization_id, key);
create index if not exists pipeline_stages_org_idx
  on public.pipeline_stages (organization_id, sort_order);

drop trigger if exists pipeline_stages_set_updated_at on public.pipeline_stages;
create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

alter table public.pipeline_stages enable row level security;

drop policy if exists "pipeline_stages_select_member" on public.pipeline_stages;
create policy "pipeline_stages_select_member"
  on public.pipeline_stages for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "pipeline_stages_all_admin" on public.pipeline_stages;
create policy "pipeline_stages_all_admin"
  on public.pipeline_stages for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- 2) Etapas por defecto (función reutilizable) ----------------------------------
create or replace function public.seed_default_stages(p_org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pipeline_stages (organization_id, key, name, color, sort_order, is_system)
  values
    (p_org, 'new',            'Nuevo',              '#64748b', 10, true),
    (p_org, 'qualifying',     'Cualificando',       '#0ea5e9', 20, true),
    (p_org, 'qualified',      'Cualificado',        '#6366f1', 30, true),
    (p_org, 'calendar_sent',  'Calendario enviado', '#f59e0b', 40, true),
    (p_org, 'call_scheduled', 'Llamada agendada',   '#22c55e', 50, true),
    (p_org, 'won',            'Ganado',             '#16a34a', 60, true),
    (p_org, 'not_qualified',  'No cualificado',     '#a1a1aa', 70, true),
    (p_org, 'lost',           'Perdido',            '#ef4444', 80, true)
  on conflict (organization_id, key) do nothing;
$$;

-- Sembramos en todas las organizaciones existentes.
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_default_stages(o.id);
  end loop;
end$$;

-- Y en cada organización nueva, automáticamente.
create or replace function public.organizations_seed_stages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_stages(new.id);
  return new;
end$$;

drop trigger if exists organizations_seed_stages on public.organizations;
create trigger organizations_seed_stages
  after insert on public.organizations
  for each row execute function public.organizations_seed_stages();

-- 3) enum → text en las columnas que guardan la etapa ----------------------------
alter table public.conversations
  alter column stage drop default,
  alter column stage type text using stage::text,
  alter column stage set default 'new';

alter table public.tag_definitions
  alter column set_stage type text using set_stage::text;

-- El enum ya no lo usa nadie.
drop type if exists public.funnel_stage;
