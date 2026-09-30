-- =============================================================================
-- Migración 0024 — Multi-agente
--
--   Hasta ahora cada organización tenía UN setter (`setter_configs`) con un
--   "modo soporte" embebido. Ahora:
--     - `setter_configs` pasa a ser la BASE DE CONOCIMIENTO común del negocio
--       (empresa, oferta, producto, prueba social, precios, equipo, brief…) +
--       ajustes globales de comportamiento (delays, horario, modelo, tope de
--       tokens). No se renombra la tabla para no romper nada.
--     - `agents`: agentes ilimitados por organización, cada uno con su
--       personalidad, objetivo, reglas, criterios, ejemplos y agenda. Tipos:
--         setter  → cualifica y agenda (usa etapas del pipeline)
--         support → resuelve dudas (sus conversaciones NO llevan etapas)
--         custom  → lo que el cliente defina
--     - Asignación: `channels.agent_id` (agente por defecto del canal) y
--       `conversations.agent_id` (override por conversación). Si ambos son
--       null se usa el primer agente setter activo de la organización.
--     - `workflows.agent_id`: el workflow pertenece a un agente; al "Pasar a
--       IA" es ese agente el que retoma la conversación.
--     - Migración de datos: por cada setter_configs se crean dos agentes
--       ("Setter" con los campos de conversación; "Soporte" con los de
--       soporte) y todos los canales quedan asignados al Setter.
-- =============================================================================

create table if not exists public.agents (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  -- Nombre interno del agente (lo que ve el cliente en la lista).
  name                    text not null,
  kind                    text not null default 'setter'
                          check (kind in ('setter', 'support', 'custom')),
  is_active               boolean not null default true,
  -- Si false, sus conversaciones no muestran etapa ni cuentan en el embudo.
  uses_stages             boolean not null default true,

  -- Personalidad / identidad con la que habla
  persona_name            text not null default 'Alex',
  identity_role           text not null default 'Setter del equipo comercial',
  objective               text not null default 'Cualificar al lead y agendar una llamada con un closer.',
  tone                    text not null default 'Cercano, humano, profesional. Tutea. Mensajes cortos.',
  rules                   text,
  instructions            text,
  qualification_criteria  text,
  funnel_phases           text,
  conversation_types      text,
  special_cases           text,
  followups               text,
  best_practices          text,
  winning_examples        text,

  -- Agendamiento
  calendar_mode           text not null default 'off' check (calendar_mode in ('off', 'slots', 'link')),
  calendar_link           text,
  call_duration_min       int  not null default 30,
  default_calendar_id     uuid references public.calendars (id) on delete set null,

  -- Modelo (null = el de la Base de Conocimiento / plataforma)
  model                   text,

  sort_order              int not null default 0,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists agents_org_idx on public.agents (organization_id, sort_order, created_at);

drop trigger if exists agents_set_updated_at on public.agents;
create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function public.set_updated_at();

alter table public.agents enable row level security;

drop policy if exists "agents_select_member" on public.agents;
create policy "agents_select_member"
  on public.agents for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "agents_all_admin" on public.agents;
create policy "agents_all_admin"
  on public.agents for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Asignaciones -------------------------------------------------------------------
alter table public.channels
  add column if not exists agent_id uuid references public.agents (id) on delete set null;

alter table public.conversations
  add column if not exists agent_id uuid references public.agents (id) on delete set null;
create index if not exists conversations_agent_idx on public.conversations (agent_id);

alter table public.workflows
  add column if not exists agent_id uuid references public.agents (id) on delete set null;

-- Migración de datos: setter_configs → agente Setter + agente Soporte -------------
do $$
declare
  c record;
  setter_id uuid;
begin
  for c in select * from public.setter_configs loop
    -- Solo si la organización aún no tiene agentes (idempotente).
    if exists (select 1 from public.agents a where a.organization_id = c.organization_id) then
      continue;
    end if;

    insert into public.agents (
      organization_id, name, kind, is_active, uses_stages,
      persona_name, identity_role, objective, tone, rules,
      qualification_criteria, funnel_phases, conversation_types, special_cases,
      followups, best_practices, winning_examples,
      calendar_mode, calendar_link, call_duration_min, default_calendar_id,
      model, sort_order
    ) values (
      c.organization_id, 'Setter', 'setter', true, true,
      c.setter_name, c.identity_role, c.objective, c.tone, c.rules,
      c.qualification_criteria, c.funnel_phases, c.conversation_types, c.special_cases,
      c.followups, c.best_practices, c.winning_examples,
      coalesce(c.calendar_mode, 'off'), c.calendar_link, coalesce(c.call_duration_min, 30), c.default_calendar_id,
      null, 10
    ) returning id into setter_id;

    insert into public.agents (
      organization_id, name, kind, is_active, uses_stages,
      persona_name, identity_role, objective, tone, rules, instructions,
      calendar_mode, sort_order
    ) values (
      c.organization_id, 'Soporte', 'support', coalesce(c.support_enabled, true), false,
      c.setter_name, c.identity_role,
      coalesce(c.support_objective, 'Resolver dudas y dar soporte de forma cercana. Si detectas interés real de compra, cualifica con naturalidad y ofrece una llamada.'),
      c.tone, c.rules, c.support_instructions,
      'off', 20
    );

    update public.channels
      set agent_id = setter_id
      where organization_id = c.organization_id and agent_id is null;
  end loop;
end$$;
