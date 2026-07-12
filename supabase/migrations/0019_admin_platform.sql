-- =============================================================================
-- Migración 0019 — Panel de administración de plataforma
--
--   Añade lo necesario para que el panel Admin gestione la plataforma (no una
--   subcuenta):
--     1. platform_settings : ajustes globales. Incluye el "entrenamiento base"
--        del setter (prompt base que HEREDAN todas las subcuentas).
--     2. error_logs        : registro de errores del sistema para diagnóstico.
--     3. Facturación        : precio mensual, próximo cobro e IDs de Stripe en
--        `organizations`, más una tabla `payments` con el histórico de cobros.
--
--   Todas las tablas nuevas van con RLS activada y SIN políticas: solo el
--   service role (la API de platform admin) las lee/escribe.
-- =============================================================================

-- 1) Ajustes globales de plataforma (fila única) --------------------------------
create table if not exists public.platform_settings (
  id                 boolean primary key default true,
  base_setter_prompt text,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  constraint platform_settings_singleton check (id)
);

-- Garantiza que exista siempre la fila única.
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

-- 2) Logs de errores del sistema ------------------------------------------------
create table if not exists public.error_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations (id) on delete set null,
  level            text not null default 'error',   -- error | warn
  source           text,                            -- p.ej. 'AllExceptionsFilter'
  message          text not null,
  detail           jsonb,
  request_method   text,
  request_path     text,
  status_code      int,
  created_at       timestamptz not null default now()
);

create index if not exists error_logs_created_idx
  on public.error_logs (created_at desc);
create index if not exists error_logs_org_idx
  on public.error_logs (organization_id, created_at desc);

alter table public.error_logs enable row level security;

-- 3) Facturación / pagos --------------------------------------------------------
alter table public.organizations
  add column if not exists monthly_price_usd      numeric(10,2),
  add column if not exists next_charge_at         timestamptz,
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;

create table if not exists public.payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  amount_usd       numeric(10,2) not null,
  currency         text not null default 'USD',
  method           text not null default 'manual',  -- manual | stripe
  status           text not null default 'paid',    -- paid | pending | failed | refunded
  period_start     date,
  period_end       date,
  note             text,
  external_id      text,                            -- id de Stripe (idempotencia)
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create index if not exists payments_org_idx
  on public.payments (organization_id, created_at desc);
create unique index if not exists payments_external_idx
  on public.payments (external_id) where external_id is not null;

alter table public.payments enable row level security;
