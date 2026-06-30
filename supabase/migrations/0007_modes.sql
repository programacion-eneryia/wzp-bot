-- =============================================================================
-- Migración 0007 — Modo de conversación (Setter vs Soporte) + cerebro de Soporte
--
-- Clasificamos cada conversación para saber cómo actúa el bot:
--   - setter:       lead nuevo / de campaña → cualificar y agendar.
--   - support:      relación existente → resolver dudas; escala a setter si hay interés.
--   - ignored:      chat personal / no comercial → el bot no responde.
--   - unclassified: aún sin clasificar (lo decidirá el clasificador IA).
-- `mode_locked` = true cuando el modo lo fija el usuario a mano (no reevaluar).
--
-- Además añade el "cerebro" de Soporte a setter_configs y la plantilla del
-- primer mensaje proactivo.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'conversation_mode') then
    create type public.conversation_mode as enum ('unclassified', 'setter', 'support', 'ignored');
  end if;
end$$;

alter table public.conversations
  add column if not exists mode        public.conversation_mode not null default 'unclassified';
alter table public.conversations
  add column if not exists mode_locked boolean not null default false;

-- --- Cerebro de Soporte (separado del Setter) ---
alter table public.setter_configs
  add column if not exists support_enabled      boolean not null default true;
alter table public.setter_configs
  add column if not exists support_objective    text
    default 'Resolver dudas y dar soporte de forma cercana. Si detectas interés real de compra, cualifica con naturalidad y ofrece una llamada.';
alter table public.setter_configs
  add column if not exists support_instructions text;

-- --- Mensaje proactivo (primer contacto a un lead) ---
alter table public.setter_configs
  add column if not exists proactive_template   text;
