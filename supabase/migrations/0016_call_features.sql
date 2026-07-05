-- =============================================================================
-- Migración 0016 — Requisitos de la llamada con Eneryia
--
--   1. `conversations.lead_context`: info que dejó el lead al registrarse
--      (respuestas del formulario de GHL, incluida la de cualificación). El bot
--      la usa como contexto para adaptar la conversación.
--   2. `conversations.assigned_to`: asignar un chat a un miembro del equipo.
--   3. `ai_usage`: registro de consumo de IA (tokens + coste) por llamada al LLM,
--      para control de costes y límites.
--   4. `setter_configs.daily_token_limit`: tope de tokens por día y organización
--      (0 = ilimitado) para evitar gastos desbocados.
-- =============================================================================

-- 1) Contexto del lead (respuestas del formulario) -----------------------------
alter table public.conversations
  add column if not exists lead_context text;

-- 2) Asignación de chats a un miembro del equipo -------------------------------
alter table public.conversations
  add column if not exists assigned_to uuid references auth.users (id) on delete set null;
create index if not exists conversations_assigned_idx
  on public.conversations (organization_id, assigned_to);

-- 3) Consumo de IA (tokens + coste) --------------------------------------------
create table if not exists public.ai_usage (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  conversation_id   uuid,
  model             text,
  purpose           text,            -- respond | classify | analyze | assistant | playground | detect | generate
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens      integer not null default 0,
  cost_usd          numeric(12, 6) not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists ai_usage_org_created_idx on public.ai_usage (organization_id, created_at desc);

alter table public.ai_usage enable row level security;

-- Los miembros de la org pueden ver su consumo; el backend (service role) escribe.
drop policy if exists "ai_usage_select_member" on public.ai_usage;
create policy "ai_usage_select_member"
  on public.ai_usage for select
  using (organization_id in (select public.user_org_ids()));

-- 4) Límite diario de tokens por organización ----------------------------------
alter table public.setter_configs
  add column if not exists daily_token_limit integer not null default 0;  -- 0 = ilimitado
