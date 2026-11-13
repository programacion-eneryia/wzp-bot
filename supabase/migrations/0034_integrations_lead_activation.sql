-- Cuándo se activa el setter para los leads que entran por webhook (GHL, Zapier…):
--   auto    → en cuanto el lead entra (comportamiento de siempre; por defecto).
--   webhook → el lead entra con la IA en pausa y solo se activa cuando el
--             workflow externo llama a la URL de control con {"action":"resume"}
--             (o alguien lo activa a mano). Así el orden es explícito:
--             registrar → enviar plantilla → activar.
alter table public.integrations
  add column if not exists lead_activation text not null default 'auto'
  check (lead_activation in ('auto', 'webhook'));
