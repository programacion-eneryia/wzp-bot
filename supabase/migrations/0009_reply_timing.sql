-- =============================================================================
-- Migración 0009 — Bajar el "tiempo en contestar" por defecto
--
-- 45-90s era demasiado: provocaba que las respuestas salieran a destiempo y se
-- mezclaran con los mensajes nuevos del lead. Con el nuevo pipeline (debounce +
-- agrupado) basta un retardo corto para sonar humano.
-- =============================================================================

alter table public.setter_configs alter column first_reply_min_s set default 5;
alter table public.setter_configs alter column first_reply_max_s set default 15;

-- Actualizamos las que seguían con el valor antiguo (45/90).
update public.setter_configs
  set first_reply_min_s = 5, first_reply_max_s = 15
  where first_reply_min_s = 45 and first_reply_max_s = 90;
