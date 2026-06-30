-- =============================================================================
-- Migración 0010 — Capa de transporte + atribución de anuncios
--
-- Prepara el sistema para ser multi-transporte (Unipile sesión, WhatsApp Cloud
-- API oficial, ManyChat, GHL) sin acoplar la lógica a un proveedor, y para
-- capturar de qué anuncio viene cada lead (click-to-WhatsApp referral).
--
--   - `transport`: por qué "tubería" se envía/recibe (default 'unipile').
--   - `referral`: datos del anuncio de origen (ctwa_clid, source_id, etc.).
--   - `window_expires_at` / `last_template_at`: control de la ventana de 24h
--     (necesario para la capa oficial de WhatsApp/IG).
-- =============================================================================

alter table public.channels
  add column if not exists transport text not null default 'unipile';

alter table public.conversations
  add column if not exists transport         text not null default 'unipile';
alter table public.conversations
  add column if not exists referral          jsonb;   -- { ctwa_clid, source_id, source_url, headline, source_type }
alter table public.conversations
  add column if not exists window_expires_at timestamptz;
alter table public.conversations
  add column if not exists last_template_at  timestamptz;
