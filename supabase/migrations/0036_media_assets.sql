-- =============================================================================
-- Migración 0036 — Biblioteca de archivos (audios, vídeos, imágenes, PDFs)
--
-- Qué hace:
--   1. Crea `media_assets`: archivos que la organización guarda para que el
--      bot (la IA o un workflow) los envíe al lead cuando se cumple una
--      condición ("cuando pregunte por precios, envía el vídeo X").
--   2. Crea el bucket privado `media` en Storage (máx. 16 MB por archivo, el
--      límite de WhatsApp para audio/vídeo). El navegador sube directo a
--      Storage con una URL firmada que emite la API (Vercel limita el cuerpo
--      de una petición a 4,5 MB).
--   3. `outbox.media_id`: un mensaje en cola puede llevar un archivo adjunto.
--   4. Limpieza Instagram: el id numérico de IG se había guardado como
--      teléfono del lead; no es un teléfono.
-- =============================================================================

create table if not exists public.media_assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  -- Para la IA: cuándo conviene enviar este archivo (lenguaje natural).
  description      text,
  kind             text not null check (kind in ('audio', 'video', 'image', 'document')),
  mime_type        text not null,
  size_bytes       bigint not null default 0,
  storage_path     text not null unique,
  -- Audio: enviarlo como nota de voz (burbuja de audio) en vez de como archivo.
  as_voice_note    boolean not null default false,
  -- ¿Puede la IA decidir enviarlo? (los workflows siempre pueden).
  ai_enabled       boolean not null default true,
  -- Solo para un agente concreto (null = cualquier agente de la organización).
  agent_id         uuid references public.agents (id) on delete set null,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists media_assets_org_idx on public.media_assets (organization_id);

drop trigger if exists media_assets_set_updated_at on public.media_assets;
create trigger media_assets_set_updated_at
  before update on public.media_assets
  for each row execute function public.set_updated_at();

alter table public.media_assets enable row level security;

drop policy if exists "media_assets_select_member" on public.media_assets;
create policy "media_assets_select_member"
  on public.media_assets for select
  using (organization_id in (select public.user_org_ids()));

-- Mensajes en cola con archivo adjunto.
alter table public.outbox
  add column if not exists media_id uuid references public.media_assets (id) on delete set null;

-- Bucket privado para los archivos.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 16777216)
on conflict (id) do update set public = false, file_size_limit = 16777216;

-- Instagram: el handle es el id del contacto en IG, no un teléfono.
update public.leads
set phone = null
where provider = 'instagram' and phone ~ '^\+?[0-9]{13,17}$';
