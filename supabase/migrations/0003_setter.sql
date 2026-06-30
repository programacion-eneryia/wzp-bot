-- =============================================================================
-- Migración 0003 — Motor del Setter con IA
--
-- Qué hace:
--   1. `setter_configs`: el "cerebro" del setter por organización. Alimenta el
--      prompt del modelo con TODO el negocio (identidad, oferta, conocimiento,
--      criterios de cualificación, reglas, tono, timing, objetivo).
--   2. `conversations` + `messages`: historial de conversaciones (tanto reales
--      de los canales como de prueba del playground "Probar IA").
--   3. RLS en todas, aislado por organización.
-- =============================================================================

-- Etapas del embudo (inspirado en SkaleX: apertura → cualificar → ... → cierre).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'funnel_stage') then
    create type public.funnel_stage as enum (
      'new', 'qualifying', 'qualified', 'not_qualified',
      'call_scheduled', 'won', 'lost'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'message_role') then
    create type public.message_role as enum ('contact', 'assistant', 'agent', 'system');
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- TABLA: setter_configs  (uno por organización)
-- -----------------------------------------------------------------------------
create table if not exists public.setter_configs (
  organization_id        uuid primary key references public.organizations (id) on delete cascade,
  -- Identidad y rol del setter
  setter_name            text not null default 'Alex',
  identity_role          text not null default 'Setter del equipo comercial',
  company_name           text,
  -- Oferta y conocimiento del negocio (aquí va el "brief" completo del cliente)
  offer                  text,
  knowledge_base         text,
  -- Cómo conversa
  objective              text not null default 'Cualificar al lead y agendar una llamada con un closer.',
  qualification_criteria text,
  tone                   text not null default 'Cercano, humano, profesional. Tutea. Mensajes cortos.',
  rules                  text,
  -- Humanización / timing
  multi_bubble           boolean not null default true,
  min_delay_ms           integer not null default 1500,
  max_delay_ms           integer not null default 6000,
  -- LLM
  model                  text,
  language               text not null default 'es',
  is_active              boolean not null default true,
  updated_at             timestamptz not null default now()
);

drop trigger if exists setter_configs_set_updated_at on public.setter_configs;
create trigger setter_configs_set_updated_at
  before update on public.setter_configs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- TABLA: conversations
-- -----------------------------------------------------------------------------
create table if not exists public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  channel_id          uuid references public.channels (id) on delete set null,
  provider            public.channel_provider,
  contact_name        text,
  contact_external_id text,
  stage               public.funnel_stage not null default 'new',
  ai_enabled          boolean not null default true,
  is_test             boolean not null default false,
  last_message_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists conversations_org_idx on public.conversations (organization_id);
create index if not exists conversations_stage_idx on public.conversations (stage);

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- TABLA: messages
-- -----------------------------------------------------------------------------
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  role             public.message_role not null,
  content          text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.setter_configs enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;

-- setter_configs: miembros ven; admins editan.
drop policy if exists "setter_select_member" on public.setter_configs;
create policy "setter_select_member"
  on public.setter_configs for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "setter_insert_admin" on public.setter_configs;
create policy "setter_insert_admin"
  on public.setter_configs for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists "setter_update_admin" on public.setter_configs;
create policy "setter_update_admin"
  on public.setter_configs for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- conversations: miembros de la org ven y gestionan.
drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member"
  on public.conversations for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "conversations_all_member" on public.conversations;
create policy "conversations_all_member"
  on public.conversations for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

-- messages: miembros de la org ven y crean (en sus conversaciones).
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member"
  on public.messages for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "messages_all_member" on public.messages;
create policy "messages_all_member"
  on public.messages for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));
