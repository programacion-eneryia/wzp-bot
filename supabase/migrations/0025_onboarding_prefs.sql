-- Onboarding por organización + preferencias de dashboard por usuario.
--
-- * organizations.onboarding_completed_at: cuándo terminó (o saltó) el tour de
--   configuración. Las organizaciones existentes se marcan como completadas:
--   el onboarding solo aplica a las que se creen a partir de ahora.
-- * profiles.dashboard_prefs: widgets visibles y su orden en el Dashboard
--   (por usuario, no por organización).

alter table public.organizations
  add column if not exists onboarding_completed_at timestamptz;

update public.organizations
   set onboarding_completed_at = coalesce(onboarding_completed_at, now())
 where onboarding_completed_at is null;

alter table public.profiles
  add column if not exists dashboard_prefs jsonb;
