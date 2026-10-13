-- =============================================================================
-- Migración 0026 — Pipelines múltiples, agentes por defecto, ajustes y
-- silenciados por agente, sincronización de contactos con GHL y trigger
-- "Recibe un webhook" en workflows.
--
--   - `pipelines`: cada organización tiene varios pipelines, cada uno con sus
--     stages. Se siembran dos: "Setter" (las etapas de sistema de siempre) y
--     "Soporte". `pipeline_stages.pipeline_id` y `agents.pipeline_id` enlazan.
--     Las keys de stage siguen siendo únicas por organización, así que
--     `conversations.stage` no cambia.
--   - `agents.is_default_lead` / `is_default_conversation`: agente que se activa
--     solo cuando entra un lead o una conversación nueva. Si no hay ninguno
--     marcado, la IA arranca pausada. Se marcan en el primer setter activo para
--     conservar el comportamiento actual.
--   - `agents.behavior`: ajustes de IA propios del agente (horario, tiempos...).
--     null = hereda los generales de la cuenta.
--   - `silenced_contacts.agent_id`: silenciado solo para un agente (null = todos).
--   - `integrations.ghl_*`: token de API de GHL para crear/actualizar contactos
--     cuando el lead entra por chat.
--   - `workflows.webhook_token`: URL pública del trigger "Recibe un webhook".
-- =============================================================================

-- 1) Pipelines -------------------------------------------------------------------
create table if not exists public.pipelines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- 'setter' y 'support' identifican los sembrados; el resto lleva un slug.
  key              text not null,
  name             text not null,
  sort_order       int  not null default 0,
  -- El pipeline por defecto contiene las etapas de sistema (no se borra).
  is_default       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists pipelines_org_key_uq on public.pipelines (organization_id, key);
create unique index if not exists pipelines_one_default_uq
  on public.pipelines (organization_id) where is_default;

drop trigger if exists pipelines_set_updated_at on public.pipelines;
create trigger pipelines_set_updated_at
  before update on public.pipelines
  for each row execute function public.set_updated_at();

alter table public.pipelines enable row level security;

drop policy if exists "pipelines_select_member" on public.pipelines;
create policy "pipelines_select_member"
  on public.pipelines for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "pipelines_all_admin" on public.pipelines;
create policy "pipelines_all_admin"
  on public.pipelines for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

alter table public.pipeline_stages
  add column if not exists pipeline_id uuid references public.pipelines (id) on delete cascade;
create index if not exists pipeline_stages_pipeline_idx
  on public.pipeline_stages (pipeline_id, sort_order);

-- 2) Siembra (reutilizable: orgs nuevas, migración y fallback del servicio) -------
create or replace function public.seed_default_stages(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setter  uuid;
  v_support uuid;
begin
  select id into v_setter from public.pipelines
    where organization_id = p_org and is_default limit 1;
  if v_setter is null then
    insert into public.pipelines (organization_id, key, name, sort_order, is_default)
      values (p_org, 'setter', 'Setter', 10, true)
      on conflict (organization_id, key) do update set is_default = true
      returning id into v_setter;
  end if;

  insert into public.pipeline_stages (organization_id, pipeline_id, key, name, color, sort_order, is_system)
  values
    (p_org, v_setter, 'new',            'Nuevo',              '#64748b', 10, true),
    (p_org, v_setter, 'qualifying',     'Cualificando',       '#0ea5e9', 20, true),
    (p_org, v_setter, 'qualified',      'Cualificado',        '#6366f1', 30, true),
    (p_org, v_setter, 'calendar_sent',  'Calendario enviado', '#f59e0b', 40, true),
    (p_org, v_setter, 'call_scheduled', 'Llamada agendada',   '#22c55e', 50, true),
    (p_org, v_setter, 'won',            'Ganado',             '#16a34a', 60, true),
    (p_org, v_setter, 'not_qualified',  'No cualificado',     '#a1a1aa', 70, true),
    (p_org, v_setter, 'lost',           'Perdido',            '#ef4444', 80, true)
  on conflict (organization_id, key) do nothing;

  -- Etapas sin pipeline (creadas antes de esta migración) → pipeline por defecto.
  update public.pipeline_stages set pipeline_id = v_setter
    where organization_id = p_org and pipeline_id is null;

  select id into v_support from public.pipelines
    where organization_id = p_org and key = 'support' limit 1;
  if v_support is null then
    insert into public.pipelines (organization_id, key, name, sort_order, is_default)
      values (p_org, 'support', 'Soporte', 20, false)
      returning id into v_support;
    insert into public.pipeline_stages (organization_id, pipeline_id, key, name, color, sort_order, is_system)
    values
      (p_org, v_support, 'support_new',      'Nuevo',                '#64748b', 10, false),
      (p_org, v_support, 'support_open',     'En curso',             '#0ea5e9', 20, false),
      (p_org, v_support, 'support_waiting',  'Esperando al cliente', '#f59e0b', 30, false),
      (p_org, v_support, 'support_resolved', 'Resuelto',             '#22c55e', 40, false)
    on conflict (organization_id, key) do nothing;
  end if;
end$$;

do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.seed_default_stages(o.id);
  end loop;
end$$;

-- 3) Agentes: pipeline, por defecto y ajustes propios --------------------------
alter table public.agents
  add column if not exists pipeline_id uuid references public.pipelines (id) on delete set null,
  add column if not exists is_default_lead boolean not null default false,
  add column if not exists is_default_conversation boolean not null default false,
  add column if not exists behavior jsonb;

create unique index if not exists agents_default_lead_uq
  on public.agents (organization_id) where is_default_lead;
create unique index if not exists agents_default_conversation_uq
  on public.agents (organization_id) where is_default_conversation;

-- Soporte → pipeline "Soporte" (ahora sí lleva etapas); el resto con embudo → "Setter".
update public.agents a
  set pipeline_id = p.id, uses_stages = true
  from public.pipelines p
  where p.organization_id = a.organization_id and p.key = 'support'
    and a.kind = 'support' and a.pipeline_id is null;

update public.agents a
  set pipeline_id = p.id
  from public.pipelines p
  where p.organization_id = a.organization_id and p.is_default
    and a.kind <> 'support' and a.uses_stages and a.pipeline_id is null;

-- Conserva el comportamiento actual: el primer setter activo atiende leads y
-- conversaciones nuevas.
with first_setter as (
  select distinct on (organization_id) id, organization_id
  from public.agents
  where kind = 'setter' and is_active
  order by organization_id, sort_order, created_at
)
update public.agents a
  set is_default_lead = true, is_default_conversation = true
  from first_setter f
  where a.id = f.id
    and not exists (
      select 1 from public.agents x
      where x.organization_id = a.organization_id
        and (x.is_default_lead or x.is_default_conversation)
    );

-- 4) Silenciados por agente ------------------------------------------------------
alter table public.silenced_contacts
  add column if not exists agent_id uuid references public.agents (id) on delete cascade;
alter table public.silenced_contacts
  add column if not exists scope text generated always as (coalesce(agent_id::text, '*')) stored;
alter table public.silenced_contacts
  drop constraint if exists silenced_contacts_organization_id_identifier_key;
create unique index if not exists silenced_contacts_scope_uq
  on public.silenced_contacts (organization_id, scope, identifier);

-- 5) GoHighLevel: API para crear/actualizar contactos ---------------------------
alter table public.integrations
  add column if not exists ghl_api_token text,
  add column if not exists ghl_location_id text,
  add column if not exists ghl_setter_field text,
  add column if not exists ghl_sync_chat_leads boolean not null default true;

-- 6) Workflows: trigger "Recibe un webhook" -------------------------------------
alter table public.workflows
  add column if not exists webhook_token text;
create unique index if not exists workflows_webhook_token_uq
  on public.workflows (webhook_token) where webhook_token is not null;
