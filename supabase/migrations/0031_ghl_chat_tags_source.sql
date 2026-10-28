-- Etiquetas y origen que el bot pone en GHL a los contactos que entran por chat.
-- Configurables por cuenta (cada organización tiene su subcuenta de GHL).
-- Las etiquetas se AÑADEN al contacto (nunca reemplazan las que ya tiene) y el
-- origen solo se pone al crear un contacto nuevo.
alter table integrations
  add column if not exists ghl_chat_tags text[] not null default '{setter-ia}',
  add column if not exists ghl_chat_source text not null default 'Setter IA (chat)';
