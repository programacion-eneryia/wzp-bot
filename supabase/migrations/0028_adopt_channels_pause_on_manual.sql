-- 1) Ajuste: pausar la IA de un chat cuando una persona escribe a mano.
alter table public.setter_configs
  add column if not exists pause_on_manual boolean not null default true;

-- 2) Reconectar un número crea un canal nuevo (y chats nuevos en el proveedor).
-- adopt_channel pasa al canal nuevo el histórico y el agente del anterior y
-- borra el anterior, para que no quede "pillado" en Canales ni en los agentes.
create or replace function public.adopt_channel(p_new uuid, p_old uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n channels%rowtype;
  o channels%rowtype;
  moved uuid[];
  r record;
begin
  select * into n from channels where id = p_new for update;
  select * into o from channels where id = p_old for update;
  if n.id is null or o.id is null or n.id = o.id or n.organization_id <> o.organization_id then
    raise exception 'adopt_channel: pareja inválida (% / %)', p_new, p_old;
  end if;

  select coalesce(array_agg(id), '{}') into moved from conversations where channel_id = o.id;

  -- Los ids de chat del canal viejo ya no existen: se vacían para que el primer
  -- mensaje (entrante o saliente) por el canal nuevo vuelva a enlazarlos por teléfono.
  -- Nada de respuestas pendientes a mensajes antiguos al recuperarlas.
  update conversations
     set channel_id = n.id, unipile_chat_id = null, contact_external_id = null, archived_at = null,
         respond_after = null, responding_lock_at = null
   where id = any(moved);

  -- Si el canal nuevo ya tiene el chat de ese teléfono, se unen (conservando el
  -- histórico) y se descartan los mensajes que la resincronización duplicó.
  for r in
    select distinct on (nc.id) oc.id as keep_id, nc.id as drop_id
      from conversations nc
      join conversations oc
        on oc.id = any(moved)
       and oc.id <> nc.id
       and length(regexp_replace(oc.contact_handle, '\D', '', 'g')) >= 8
       and regexp_replace(oc.contact_handle, '\D', '', 'g') = regexp_replace(nc.contact_handle, '\D', '', 'g')
     where nc.channel_id = n.id
       and not (nc.id = any(moved))
     order by nc.id, oc.last_message_at desc nulls last
  loop
    delete from messages m
     where m.conversation_id = r.drop_id
       and exists (
         select 1 from messages k
          where k.conversation_id = r.keep_id
            and k.content = m.content
            and abs(extract(epoch from k.created_at - m.created_at)) < 120
       );
    perform merge_conversations(r.keep_id, r.drop_id);
  end loop;

  update channels set agent_id = coalesce(n.agent_id, o.agent_id) where id = n.id;
  update integrations set default_channel_id = n.id where default_channel_id = o.id;
  delete from channels where id = o.id;

  return coalesce(array_length(moved, 1), 0);
end;
$$;

revoke all on function public.adopt_channel(uuid, uuid) from public, anon, authenticated;

-- 3) Reparación: números ya reconectados (mismo proveedor y nombre que uno conectado).
do $$
declare
  r record;
begin
  for r in
    select distinct on (o.id) n.id as new_id, o.id as old_id
      from channels o
      join channels n
        on n.organization_id = o.organization_id
       and n.provider = o.provider
       and n.display_name = o.display_name
       and n.status = 'connected'
       and n.id <> o.id
     where o.status <> 'connected'
     order by o.id, n.connected_at desc nulls last
  loop
    perform adopt_channel(r.new_id, r.old_id);
  end loop;
end $$;

-- 4) Intentos de conexión fallidos o abandonados que nunca tuvieron chats.
delete from channels c
 where c.status in ('disconnected', 'error', 'pending')
   and (c.status <> 'pending' or c.created_at < now() - interval '1 day')
   and not exists (select 1 from conversations v where v.channel_id = c.id);

-- 5) Natabel: el Setter antiguo (inactivo) se duplicó al regenerar la base de
-- conocimiento. Sus chats pasan al Setter actual y se elimina.
update conversations set agent_id = '1a4fb5ba-7775-41d8-8abd-0bb58b4fee05'
 where agent_id = '62088ea7-995b-45de-ad18-6a2a08cf8230'
   and exists (select 1 from agents where id = '1a4fb5ba-7775-41d8-8abd-0bb58b4fee05');
update channels set agent_id = '1a4fb5ba-7775-41d8-8abd-0bb58b4fee05'
 where agent_id = '62088ea7-995b-45de-ad18-6a2a08cf8230'
   and exists (select 1 from agents where id = '1a4fb5ba-7775-41d8-8abd-0bb58b4fee05');
update workflows set agent_id = '1a4fb5ba-7775-41d8-8abd-0bb58b4fee05'
 where agent_id = '62088ea7-995b-45de-ad18-6a2a08cf8230'
   and exists (select 1 from agents where id = '1a4fb5ba-7775-41d8-8abd-0bb58b4fee05');
delete from agents
 where id = '62088ea7-995b-45de-ad18-6a2a08cf8230'
   and exists (select 1 from agents where id = '1a4fb5ba-7775-41d8-8abd-0bb58b4fee05')
   and not exists (select 1 from conversations where agent_id = '62088ea7-995b-45de-ad18-6a2a08cf8230');
