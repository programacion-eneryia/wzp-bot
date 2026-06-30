-- =============================================================================
-- Migración 0001 — Fundación multi-tenant (organizaciones, perfiles, roles)
--
-- Qué hace:
--   1. Crea las tablas núcleo del SaaS: profiles, organizations, memberships.
--   2. Activa Row Level Security (RLS) en todas: cada usuario SOLO ve los datos
--      de las organizaciones a las que pertenece.
--   3. Crea funciones de ayuda (SECURITY DEFINER) para evitar recursión en RLS.
--   4. Crea un trigger que genera el "profile" automáticamente al registrarse.
--   5. Crea una función para crear una organización y hacerte admin de ella.
--
-- Cómo ejecutarlo:
--   Pega todo este archivo en Supabase → SQL Editor → Run.
-- =============================================================================

-- Tipo de rol dentro de una organización.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'closer');
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- TABLA: profiles  (espejo de auth.users con datos públicos del usuario)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- TABLA: organizations  (cada cliente = un tenant)
-- -----------------------------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  plan        text not null default 'free',
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- TABLA: memberships  (qué usuario pertenece a qué organización y con qué rol)
-- -----------------------------------------------------------------------------
create table if not exists public.memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             public.user_role not null default 'closer',
  created_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx on public.memberships (organization_id);

-- -----------------------------------------------------------------------------
-- FUNCIONES DE AYUDA PARA RLS
-- Son SECURITY DEFINER: se ejecutan con permisos elevados y NO disparan RLS,
-- lo que evita recursión infinita al consultar memberships dentro de políticas.
-- -----------------------------------------------------------------------------

-- Devuelve los IDs de organización a los que pertenece el usuario actual.
create or replace function public.user_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id
  from public.memberships
  where user_id = auth.uid();
$$;

-- ¿El usuario actual es admin de esta organización?
create or replace function public.is_org_admin(org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and organization_id = org
      and role = 'admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- ACTIVAR RLS
-- -----------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.organizations  enable row level security;
alter table public.memberships    enable row level security;

-- -----------------------------------------------------------------------------
-- POLÍTICAS: profiles
-- -----------------------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- POLÍTICAS: organizations
-- -----------------------------------------------------------------------------
-- Ver solo las organizaciones a las que perteneces.
drop policy if exists "orgs_select_member" on public.organizations;
create policy "orgs_select_member"
  on public.organizations for select
  using (id in (select public.user_org_ids()));

-- Solo un admin puede modificar su organización.
drop policy if exists "orgs_update_admin" on public.organizations;
create policy "orgs_update_admin"
  on public.organizations for update
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

-- (La CREACIÓN de organizaciones se hace con la función create_organization de
--  más abajo, no con INSERT directo, para crear la membership de admin a la vez.)

-- -----------------------------------------------------------------------------
-- POLÍTICAS: memberships
-- -----------------------------------------------------------------------------
-- Ver las membresías de tus propias organizaciones (para la página de Equipo).
drop policy if exists "memberships_select_org" on public.memberships;
create policy "memberships_select_org"
  on public.memberships for select
  using (organization_id in (select public.user_org_ids()));

-- Solo admins pueden añadir/editar/eliminar miembros de su organización.
drop policy if exists "memberships_insert_admin" on public.memberships;
create policy "memberships_insert_admin"
  on public.memberships for insert
  with check (public.is_org_admin(organization_id));

drop policy if exists "memberships_update_admin" on public.memberships;
create policy "memberships_update_admin"
  on public.memberships for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

drop policy if exists "memberships_delete_admin" on public.memberships;
create policy "memberships_delete_admin"
  on public.memberships for delete
  using (public.is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- TRIGGER: crear profile automáticamente cuando alguien se registra
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- FUNCIÓN: crear una organización y hacerte admin (transacción atómica)
-- El frontend llamará a esta función (RPC) en vez de hacer INSERT directo.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(org_name text, org_slug text)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.organizations;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  insert into public.organizations (name, slug)
  values (org_name, org_slug)
  returning * into new_org;

  insert into public.memberships (organization_id, user_id, role)
  values (new_org.id, auth.uid(), 'admin');

  return new_org;
end;
$$;
