-- =============================================================================
-- Migración 0002 — Canales conectados (Unipile)
--
-- Qué hace:
--   1. Crea la tabla `channels`: cada fila es una cuenta de mensajería
--      (WhatsApp / Instagram / Messenger...) conectada a una organización
--      a través de Unipile.
--   2. Activa RLS: los miembros ven los canales de su organización; solo los
--      admins pueden conectar/editar/desconectar.
--   3. Mantiene `updated_at` con un trigger genérico.
--
-- Notas de seguridad:
--   - NO guardamos credenciales del canal. Unipile custodia la sesión; nosotros
--     solo almacenamos su `unipile_account_id` (un identificador, no un secreto).
-- =============================================================================

-- Proveedores soportados por Unipile que nos interesan.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'channel_provider') then
    create type public.channel_provider as enum (
      'whatsapp', 'instagram', 'messenger', 'linkedin', 'telegram'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'channel_status') then
    create type public.channel_status as enum (
      'pending', 'connected', 'error', 'disconnected'
    );
  end if;
end$$;

-- Función genérica para refrescar updated_at (reutilizable por otras tablas).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- TABLA: channels
-- -----------------------------------------------------------------------------
create table if not exists public.channels (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  provider            public.channel_provider not null,
  status              public.channel_status not null default 'pending',
  -- Id de la cuenta en Unipile (se rellena cuando la conexión se completa).
  unipile_account_id  text unique,
  display_name        text,
  metadata            jsonb not null default '{}'::jsonb,
  last_error          text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  connected_at        timestamptz
);

create index if not exists channels_org_idx on public.channels (organization_id);
create index if not exists channels_status_idx on public.channels (status);

drop trigger if exists channels_set_updated_at on public.channels;
create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.channels enable row level security;

-- Ver los canales de tus organizaciones.
drop policy if exists "channels_select_member" on public.channels;
create policy "channels_select_member"
  on public.channels for select
  using (organization_id in (select public.user_org_ids()));

-- Solo admins conectan / editan / desconectan canales.
drop policy if exists "channels_insert_admin" on public.channels;
create policy "channels_insert_admin"
  on public.channels for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists "channels_update_admin" on public.channels;
create policy "channels_update_admin"
  on public.channels for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists "channels_delete_admin" on public.channels;
create policy "channels_delete_admin"
  on public.channels for delete
  using (public.is_org_admin(organization_id));
