-- =============================================================================
-- Migración 0008 — Entrada de leads (multicanal) + integraciones externas
--
-- Objetivo: que entren leads desde varias fuentes (campañas Meta vía GoHighLevel,
-- click-to-WhatsApp, comentarios/DMs de Instagram vía ManyChat, alta manual…),
-- que se rastree su ORIGEN, y que el bot pueda abrir conversación de forma
-- proactiva con la plantilla configurada.
--
--   1. Campos de origen y proactividad en `conversations`.
--   2. Tabla `integrations`: un registro por org con el token de intake (para
--      asegurar los webhooks entrantes), la API key de ManyChat y ajustes.
-- =============================================================================

-- --- Origen / proactividad en conversations ---
alter table public.conversations
  add column if not exists source               text;          -- ctwa | meta_lead | ghl | ig_comment | ig_dm | manychat | manual | organic
alter table public.conversations
  add column if not exists source_detail        text;          -- nombre de campaña/form/post, libre
alter table public.conversations
  add column if not exists campaign             text;          -- id de campaña/anuncio si lo tenemos
alter table public.conversations
  add column if not exists consent_optin        boolean not null default false; -- el lead dejó su contacto / opt-in
alter table public.conversations
  add column if not exists proactive_sent       boolean not null default false; -- ya le enviamos el primer mensaje
alter table public.conversations
  add column if not exists external_subscriber_id text;        -- id del contacto en el sistema externo (p.ej. ManyChat subscriber_id)

create index if not exists conversations_subscriber_idx
  on public.conversations (organization_id, external_subscriber_id);

-- -----------------------------------------------------------------------------
-- TABLA: integrations  (uno por organización)
-- -----------------------------------------------------------------------------
create table if not exists public.integrations (
  organization_id     uuid primary key references public.organizations (id) on delete cascade,
  -- Secreto que deben incluir los sistemas externos al llamar a nuestros
  -- webhooks de entrada de leads (GHL, ManyChat, Zapier, etc.).
  intake_token        text not null default replace(gen_random_uuid()::text, '-', ''),
  -- API key de ManyChat (para enviar mensajes proactivos por IG si hiciera falta).
  manychat_api_key    text,
  -- Canal por defecto para abrir conversaciones proactivas (WhatsApp normalmente).
  default_channel_id  uuid references public.channels (id) on delete set null,
  -- Interruptor maestro de proactividad.
  proactive_enabled   boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists integrations_set_updated_at on public.integrations;
create trigger integrations_set_updated_at
  before update on public.integrations
  for each row execute function public.set_updated_at();

-- RLS: solo los miembros de la org pueden verla; solo admins editarla.
-- (El backend usa la service role, que ignora RLS.)
alter table public.integrations enable row level security;

drop policy if exists "integrations_select_member" on public.integrations;
create policy "integrations_select_member"
  on public.integrations for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "integrations_all_admin" on public.integrations;
create policy "integrations_all_admin"
  on public.integrations for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
