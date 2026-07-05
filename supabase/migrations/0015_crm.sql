-- =============================================================================
-- Migración 0015 — CRM de leads
--
-- Objetivo: que CADA lead que entra (por GHL, ManyChat, formulario, alta manual…)
-- quede registrado PRIMERO en el CRM con TODA su información (incluido el payload
-- original completo), enlazado a su conversación. El bot escribe DESPUÉS a esos
-- leads. Así el CRM es la fuente de verdad de "quién ha entrado y con qué datos".
--
--   - Tabla `leads`: un registro por persona/contacto, con datos normalizados +
--     `raw` (payload íntegro) + `fields` (campos personalizados del formulario).
--   - Se enlaza a `conversations` (conversation_id) cuando hay chat.
-- =============================================================================

create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Conversación asociada (el chat que el bot mantiene con este lead).
  conversation_id  uuid references public.conversations (id) on delete set null,

  -- Datos de contacto (normalizados).
  name             text,
  phone            text,            -- formato internacional (+digits) si lo hay
  email            text,
  provider         text,            -- whatsapp | instagram | messenger

  -- Origen / atribución.
  source           text,            -- ghl | manychat | meta_lead | ig_comment | ig_dm | ctwa | manual | organic
  source_detail    text,            -- nombre de campaña/form/post (libre)
  campaign         text,            -- id de campaña/anuncio si lo tenemos
  external_id      text,            -- id del contacto en el sistema externo (ManyChat subscriber, etc.)

  -- Estado en el embudo (espejo de conversations.stage).
  status           text not null default 'new',
  consent_optin    boolean not null default false,
  first_message    text,            -- primer mensaje del lead, si vino

  -- Toda la información extra que trae el lead.
  fields           jsonb not null default '{}'::jsonb,  -- campos del formulario normalizados (clave/valor)
  raw              jsonb not null default '{}'::jsonb,   -- payload ORIGINAL completo, tal cual llegó

  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists leads_org_created_idx   on public.leads (organization_id, created_at desc);
create index if not exists leads_org_status_idx     on public.leads (organization_id, status);
create index if not exists leads_org_source_idx      on public.leads (organization_id, source);
create index if not exists leads_org_email_idx       on public.leads (organization_id, email);
create index if not exists leads_org_phone_idx       on public.leads (organization_id, phone);
create index if not exists leads_org_external_idx    on public.leads (organization_id, external_id);
create index if not exists leads_conversation_idx    on public.leads (conversation_id);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- RLS: los miembros de la org pueden ver sus leads; los admins gestionarlos.
-- (El backend usa la service role, que ignora RLS: los closers editan vía API.)
alter table public.leads enable row level security;

drop policy if exists "leads_select_member" on public.leads;
create policy "leads_select_member"
  on public.leads for select
  using (organization_id in (select public.user_org_ids()));

drop policy if exists "leads_all_admin" on public.leads;
create policy "leads_all_admin"
  on public.leads for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
