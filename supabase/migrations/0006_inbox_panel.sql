-- =============================================================================
-- Migración 0006 — Panel de control de la conversación (estilo SkaleX)
--
-- Añade a `conversations`:
--   - notes:          notas internas del agente sobre el lead.
--   - blocked:        contacto bloqueado (la IA nunca responde).
--   - ai_analysis:    análisis IA cacheado de la conversación (jsonb).
--   - ai_analysis_at: cuándo se generó ese análisis.
-- =============================================================================

alter table public.conversations add column if not exists notes          text;
alter table public.conversations add column if not exists blocked        boolean not null default false;
alter table public.conversations add column if not exists ai_analysis    jsonb;
alter table public.conversations add column if not exists ai_analysis_at timestamptz;
