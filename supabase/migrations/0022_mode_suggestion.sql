-- =============================================================================
-- Migración 0022 — Sugerencia de modo (la IA propone, el humano confirma)
--
-- Antes el clasificador IA escribía directamente `mode = support|ignored`,
-- y degradaba leads reales por error: dejaban de cualificarse o el bot dejaba
-- de responderles para siempre. Ahora la IA solo APLICA `setter`; cuando
-- propone `support` o `ignored`, la propuesta se guarda en `suggested_mode`,
-- el chat sigue actuando como setter y un humano la confirma o descarta
-- desde el inbox.
-- =============================================================================

alter table public.conversations
  add column if not exists suggested_mode public.conversation_mode;
