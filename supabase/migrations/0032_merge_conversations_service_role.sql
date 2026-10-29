-- La API (service_role) fusiona una conversación creada desde un chat sin
-- teléfono visible con la del lead cuando WhatsApp revela el número.
grant execute on function public.merge_conversations(uuid, uuid) to service_role;
