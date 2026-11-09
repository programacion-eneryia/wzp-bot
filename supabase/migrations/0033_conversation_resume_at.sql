-- La persona pidió hablar más tarde ("hablamos mañana", "a las 7"): el bot lo
-- marca y el sistema retoma la conversación a esa hora, sin seguimientos antes.
alter table public.conversations
  add column if not exists resume_at timestamptz;
