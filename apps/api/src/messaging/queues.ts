export const INCOMING_QUEUE = 'incoming-messages';
export const OUTGOING_QUEUE = 'outgoing-messages';
export const RESPOND_QUEUE = 'respond-debounced';

/** Ventana de agrupado: espera tras el último mensaje del lead antes de responder. */
export const DEBOUNCE_MS = 12_000;

/** Job de respuesta agrupada (uno por conversación, con jobId = respond-<convId>). */
export type RespondJob = {
  orgId: string;
  conversationId: string;
  chatId: string;
  provider: string;
};

export type OutgoingJob = {
  orgId: string;
  conversationId: string;
  content: string;
  /** Tubería de envío ('unipile' | 'whatsapp_cloud' | 'manychat' | 'ghl'). */
  transport?: string;
  /** 'reply' = mensaje en chat existente; 'proactive' = primer contacto. */
  kind?: 'reply' | 'proactive';
  /** Para 'reply': chat de Unipile donde enviamos. */
  chatId?: string;
  /** Para 'proactive': cuenta de Unipile y destinatario (teléfono/handle). */
  accountId?: string;
  attendeeId?: string;
};
