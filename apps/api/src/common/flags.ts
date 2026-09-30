/**
 * Flags de comportamiento controlados por variable de entorno.
 */

/**
 * ¿Las conversaciones NUEVAS arrancan con la IA pausada (activación solo por
 * flow/inbox/GHL)?
 *
 * Por defecto NO (comportamiento clásico: la IA responde a todo chat nuevo).
 * Se activa poniendo `NEW_CONVERSATIONS_START_PAUSED=true` en el entorno,
 * y ANTES hay que tener creado y activo un workflow con el nodo "Pasar a IA"
 * (trigger "Cuando entra una conversación nueva" o "Cuando entra un lead"),
 * porque desde ese momento ningún chat nuevo responde solo.
 */
export function newConversationsStartPaused(): boolean {
  return (process.env.NEW_CONVERSATIONS_START_PAUSED ?? '').trim().toLowerCase() === 'true';
}
