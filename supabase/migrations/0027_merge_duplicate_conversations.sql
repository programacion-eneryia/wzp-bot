-- Un lead que entra por GHL/formulario tenía su conversación (setter_id,
-- agente, IA) sin chat, y cuando escribía por WhatsApp se creaba OTRA. Esta
-- migración fusiona esas parejas (se conserva la de GHL, cuyo id es el
-- setter_id guardado en GHL), deja un único lead por conversación y lo blinda
-- con una restricción única.

create or replace function public.merge_conversations(p_keep uuid, p_drop uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k conversations%rowtype;
  d conversations%rowtype;
  first_in timestamptz;
  human boolean;
  keep_lead uuid;
begin
  select * into k from conversations where id = p_keep for update;
  select * into d from conversations where id = p_drop for update;
  if k.id is null or d.id is null or k.id = d.id or k.organization_id <> d.organization_id then
    raise exception 'merge_conversations: pareja inválida (% / %)', p_keep, p_drop;
  end if;

  -- ¿Una persona respondió desde el móvil después de que el contacto escribiera?
  -- (lo enviado desde el móvil se importa como 'assistant' con imported=true)
  select min(created_at) into first_in from messages where conversation_id = d.id and role = 'contact';
  select exists (
    select 1 from messages m
    where m.conversation_id = d.id and first_in is not null and m.created_at > first_in
      and (m.role = 'agent' or (m.role = 'assistant' and m.metadata->>'imported' = 'true'))
  ) into human;

  update messages set conversation_id = k.id where conversation_id = d.id;
  update appointments set conversation_id = k.id where conversation_id = d.id;
  update outbox set conversation_id = k.id where conversation_id = d.id;

  delete from conversation_tags where conversation_id = d.id
    and tag_id in (select tag_id from conversation_tags where conversation_id = k.id);
  update conversation_tags set conversation_id = k.id where conversation_id = d.id;

  delete from conversation_tag_removals where conversation_id = d.id
    and tag_id in (select tag_id from conversation_tag_removals where conversation_id = k.id);
  update conversation_tag_removals set conversation_id = k.id where conversation_id = d.id;

  delete from outbound_events where conversation_id = d.id
    and kind in (select kind from outbound_events where conversation_id = k.id);
  update outbound_events set conversation_id = k.id where conversation_id = d.id;

  delete from meta_capi_events where conversation_id = d.id
    and event_name in (select event_name from meta_capi_events where conversation_id = k.id);
  update meta_capi_events set conversation_id = k.id where conversation_id = d.id;

  delete from workflow_runs where conversation_id = d.id and status in ('active', 'paused')
    and workflow_id in (
      select workflow_id from workflow_runs where conversation_id = k.id and status in ('active', 'paused')
    );
  update workflow_runs set conversation_id = k.id where conversation_id = d.id;

  -- Un solo lead: el de la conversación conservada, completado con lo del otro.
  select id into keep_lead from leads where conversation_id = k.id order by created_at, id limit 1;
  if keep_lead is null then
    select id into keep_lead from leads where conversation_id = d.id order by created_at, id limit 1;
  end if;
  if keep_lead is not null then
    update leads l set
      external_id = coalesce(l.external_id, o.external_id),
      email = coalesce(l.email, o.email),
      phone = case when l.phone ~ '^\+\d{6,15}$' then l.phone else coalesce(o.phone, l.phone) end,
      name = coalesce(nullif(l.name, 'Lead'), o.name, l.name),
      conversation_id = k.id
    from (
      select max(external_id) external_id, max(email) email,
             max(phone) filter (where phone ~ '^\+\d{6,15}$') phone,
             max(name) filter (where name <> 'Lead') name
      from leads where conversation_id in (k.id, d.id) and id <> keep_lead
    ) o
    where l.id = keep_lead;
    delete from leads where conversation_id in (k.id, d.id) and id <> keep_lead;
  end if;

  delete from conversations where id = d.id;

  update conversations set
    channel_id = coalesce(d.channel_id, k.channel_id),
    unipile_chat_id = coalesce(k.unipile_chat_id, d.unipile_chat_id),
    contact_external_id = coalesce(k.contact_external_id, d.contact_external_id),
    transport = coalesce(d.transport, k.transport),
    contact_name = case
      when k.contact_name is null or k.contact_name = 'Lead' or k.contact_name ~ '^\+?[0-9 ().-]{6,}$'
        then coalesce(nullif(d.contact_name, 'Lead'), k.contact_name)
      else k.contact_name end,
    contact_handle = coalesce(k.contact_handle, d.contact_handle),
    last_message_at = greatest(k.last_message_at, d.last_message_at),
    last_inbound_at = greatest(k.last_inbound_at, d.last_inbound_at),
    last_outbound_at = greatest(k.last_outbound_at, d.last_outbound_at),
    window_expires_at = greatest(k.window_expires_at, d.window_expires_at),
    last_template_at = greatest(k.last_template_at, d.last_template_at),
    tagged_at = greatest(k.tagged_at, d.tagged_at),
    unread_count = coalesce(k.unread_count, 0) + coalesce(d.unread_count, 0),
    notes = nullif(concat_ws(E'\n', nullif(k.notes, ''), nullif(d.notes, '')), ''),
    ai_analysis = coalesce(d.ai_analysis, k.ai_analysis),
    ai_analysis_at = greatest(k.ai_analysis_at, d.ai_analysis_at),
    stage = case when k.stage = 'new' then d.stage else k.stage end,
    assigned_to = coalesce(k.assigned_to, d.assigned_to),
    agent_id = coalesce(k.agent_id, d.agent_id),
    referral = coalesce(k.referral, d.referral),
    ghl_contact_id = coalesce(k.ghl_contact_id, d.ghl_contact_id),
    proactive_sent = k.proactive_sent or d.proactive_sent,
    blocked = k.blocked or d.blocked,
    followups_paused = k.followups_paused or d.followups_paused,
    archived_at = case when k.archived_at is not null and d.archived_at is not null
      then greatest(k.archived_at, d.archived_at) end,
    -- IA: la que ya atendía el chat, o la de GHL si nadie ha tomado el chat a mano.
    ai_enabled = d.ai_enabled or (k.ai_enabled and not human),
    -- Sin respuestas automáticas de golpe a mensajes antiguos.
    respond_after = null,
    responding_lock_at = null
  where id = k.id;
end;
$$;

revoke all on function public.merge_conversations(uuid, uuid) from public, anon, authenticated;

-- 1) Conversaciones con id interno de WhatsApp (@lid) cuyo lead sí tiene el teléfono.
update conversations c set contact_handle = l.phone
from leads l
where l.conversation_id = c.id
  and c.contact_handle like '%@lid'
  and l.phone ~ '^\+\d{6,15}$';

-- 2) Fusiona cada conversación de GHL (sin chat) con la del chat del mismo teléfono.
do $$
declare
  r record;
begin
  for r in
    select k.id as keep_id, d.id as drop_id
    from conversations k
    join conversations d
      on d.organization_id = k.organization_id
     and d.contact_handle = k.contact_handle
     and d.provider = k.provider
     and d.id <> k.id
    where k.contact_handle like '+%'
      and not k.is_test and not d.is_test
      and k.unipile_chat_id is null and k.contact_external_id is null
      and d.unipile_chat_id is not null
    order by k.created_at
  loop
    -- Si la de GHL ya se vinculó en una vuelta anterior, esta pareja ya no aplica.
    if exists (
      select 1 from conversations
      where id = r.keep_id and unipile_chat_id is null and contact_external_id is null
    ) and exists (select 1 from conversations where id = r.drop_id) then
      perform public.merge_conversations(r.keep_id, r.drop_id);
    end if;
  end loop;
end $$;

-- 3) Un único lead por conversación (el más antiguo, completado con los demás).
with dup as (
  select conversation_id from leads where conversation_id is not null
  group by conversation_id having count(*) > 1
), keeper as (
  select distinct on (l.conversation_id) l.conversation_id, l.id
  from leads l join dup using (conversation_id)
  order by l.conversation_id, l.created_at, l.id
), agg as (
  select l.conversation_id,
         max(l.external_id) external_id, max(l.email) email,
         max(l.phone) filter (where l.phone ~ '^\+\d{6,15}$') phone,
         max(l.name) filter (where l.name <> 'Lead') name
  from leads l join dup using (conversation_id)
  group by l.conversation_id
)
update leads l set
  external_id = coalesce(l.external_id, a.external_id),
  email = coalesce(l.email, a.email),
  phone = case when l.phone ~ '^\+\d{6,15}$' then l.phone else coalesce(a.phone, l.phone) end,
  name = coalesce(nullif(l.name, 'Lead'), a.name, l.name)
from keeper k join agg a using (conversation_id)
where l.id = k.id;

delete from leads l
using (
  select id, row_number() over (partition by conversation_id order by created_at, id) rn
  from leads where conversation_id is not null
) r
where l.id = r.id and r.rn > 1;

alter table leads add constraint leads_conversation_id_key unique (conversation_id);

-- 4) Nombre real desde el CRM cuando la conversación solo tiene un número o 'Lead'.
update conversations c set contact_name = l.name
from leads l
where l.conversation_id = c.id
  and (c.contact_name is null or c.contact_name = 'Lead' or c.contact_name ~ '^\+?[0-9 ().-]{6,}$')
  and l.name is not null and l.name <> 'Lead' and l.name !~ '^\+?[0-9 ().-]{6,}$';
