-- merge_conversations: el canal (y el transporte) deben ir con el chat que se
-- conserva. Antes se tomaba siempre el de la conversación eliminada, y si esa
-- apuntaba a un canal caído el chat quedaba colgando de él (y el siguiente
-- mensaje del lead creaba una conversación duplicada).
do $$
declare
  def text;
begin
  select pg_get_functiondef('public.merge_conversations(uuid,uuid)'::regprocedure) into def;
  def := replace(
    def,
    'channel_id = coalesce(d.channel_id, k.channel_id),',
    'channel_id = case when k.unipile_chat_id is not null then coalesce(k.channel_id, d.channel_id) else coalesce(d.channel_id, k.channel_id) end,'
  );
  def := replace(
    def,
    'transport = coalesce(d.transport, k.transport),',
    'transport = case when k.unipile_chat_id is not null then coalesce(k.transport, d.transport) else coalesce(d.transport, k.transport) end,'
  );
  if position('then coalesce(k.channel_id, d.channel_id)' in def) = 0
     or position('then coalesce(k.transport, d.transport)' in def) = 0 then
    raise exception 'merge_conversations: no se pudo aplicar el parche';
  end if;
  execute def;
end $$;
