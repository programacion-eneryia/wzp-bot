-- =============================================================================
-- Migración 0035 — Cuándo cambió por última vez el estado de un canal
--
-- Para avisar al usuario de que su WhatsApp/Instagram se ha desconectado
-- ("desde hace 2 horas") necesitamos saber cuándo pasó el canal a ese estado.
-- `updated_at` no sirve (cambia con cualquier edición), así que un trigger
-- fija `status_changed_at` solo cuando cambia `status`.
-- =============================================================================

alter table public.channels
  add column if not exists status_changed_at timestamptz not null default now();

create or replace function public.channels_track_status_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists channels_track_status_change on public.channels;
create trigger channels_track_status_change
  before update on public.channels
  for each row execute function public.channels_track_status_change();

-- Valor inicial razonable para las filas existentes.
update public.channels set status_changed_at = coalesce(updated_at, created_at, now());

-- Los canales ya desconectados sin cuenta en el proveedor se consideran
-- desconectados a propósito (no disparan la alerta de "canal caído").
update public.channels
set metadata = coalesce(metadata, '{}'::jsonb) || '{"disconnected_by_user": true}'::jsonb
where status = 'disconnected' and unipile_account_id is null;
