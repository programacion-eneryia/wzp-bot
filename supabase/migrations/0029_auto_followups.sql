-- Seguimiento automático: si el lead no responde al bot, el agente le vuelve a
-- escribir según una secuencia de esperas (en minutos) configurable por agente.

alter table public.agents
  add column if not exists followup_enabled boolean not null default false,
  add column if not exists followup_delays_min integer[] not null default '{60,1440,4320}';

alter table public.conversations
  add column if not exists next_followup_at timestamptz,
  add column if not exists followup_count integer not null default 0;

create index if not exists conversations_next_followup_idx
  on public.conversations (next_followup_at)
  where next_followup_at is not null;
