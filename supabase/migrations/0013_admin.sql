-- =============================================================================
-- Migración 0013 — Panel de administración (plataforma + equipo)
--
--   1. `is_platform_admin` en profiles (super admin del SaaS).
--   2. Estado + datos de facturación (Stripe, futuro) en organizations.
--   3. Tabla `audit_logs` para auditar acciones de admin (crear, impersonar…).
--   4. Helper `is_platform_admin()` + políticas RLS para que el super admin
--      pueda ver/gestionar TODAS las organizaciones, miembros y perfiles.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: super admin de plataforma
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_platform_admin boolean not null default false;

-- -----------------------------------------------------------------------------
-- organizations: estado + facturación (Stripe se rellena en el futuro)
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists status text not null default 'active'; -- active | suspended
alter table public.organizations
  add column if not exists seats integer; -- límite de usuarios (null = sin límite)
alter table public.organizations
  add column if not exists stripe_customer_id text;
alter table public.organizations
  add column if not exists stripe_subscription_id text;
alter table public.organizations
  add column if not exists subscription_status text; -- trialing|active|past_due|canceled…
alter table public.organizations
  add column if not exists created_by uuid references auth.users (id) on delete set null;
alter table public.organizations
  add column if not exists updated_at timestamptz not null default now();

-- -----------------------------------------------------------------------------
-- HELPER: ¿el usuario actual es super admin de plataforma?
-- SECURITY DEFINER para no disparar RLS (evita recursión en políticas).
-- -----------------------------------------------------------------------------
create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_platform_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- TABLA: audit_logs
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id               uuid primary key default gen_random_uuid(),
  actor_id         uuid references auth.users (id) on delete set null,
  actor_email      text,
  action           text not null,            -- 'user.create', 'user.impersonate'…
  target_type      text,                     -- 'user' | 'organization' | …
  target_id        text,
  organization_id  uuid references public.organizations (id) on delete set null,
  metadata         jsonb not null default '{}'::jsonb,
  ip               text,
  created_at       timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_org_idx on public.audit_logs (organization_id);

alter table public.audit_logs enable row level security;

-- Solo el super admin de plataforma puede leer la auditoría (la escritura va por
-- el backend con service_role, que ignora RLS).
drop policy if exists "audit_select_platform" on public.audit_logs;
create policy "audit_select_platform"
  on public.audit_logs for select
  using (public.is_platform_admin());

-- -----------------------------------------------------------------------------
-- POLÍTICAS RLS extra para el super admin (acceso total)
-- -----------------------------------------------------------------------------
drop policy if exists "orgs_platform_all" on public.organizations;
create policy "orgs_platform_all"
  on public.organizations for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "memberships_platform_all" on public.memberships;
create policy "memberships_platform_all"
  on public.memberships for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "profiles_platform_select" on public.profiles;
create policy "profiles_platform_select"
  on public.profiles for select
  using (public.is_platform_admin());

drop policy if exists "profiles_platform_update" on public.profiles;
create policy "profiles_platform_update"
  on public.profiles for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
