import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SupabaseService } from '../supabase/supabase.service';
import { UnipileService } from '../unipile/unipile.service';
import { SetterService } from '../setter/setter.service';
import { SetterConfigService } from '../setter/setter-config.service';
import { SilencedContactsService } from '../setter/silenced-contacts.service';
import { ConversationClassifierService } from '../setter/conversation-classifier.service';
import { AppointmentDetectorService } from '../calendar/appointment-detector.service';
import { TransportService } from './transport.service';
import {
  DEBOUNCE_MS,
  INCOMING_QUEUE,
  OUTGOING_QUEUE,
  RESPOND_QUEUE,
  type OutgoingJob,
  type RespondJob,
} from './queues';

type IncomingEvent = {
  accountId: string;
  chatId: string;
  text: string;
  messageId?: string;
  senderName?: string;
  senderProviderId?: string;
};

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly unipile: UnipileService,
    private readonly setter: SetterService,
    private readonly setterConfig: SetterConfigService,
    private readonly silenced: SilencedContactsService,
    private readonly classifier: ConversationClassifierService,
    private readonly appointmentDetector: AppointmentDetectorService,
    private readonly transport: TransportService,
    @InjectQueue(INCOMING_QUEUE) private readonly incomingQueue: Queue,
    @InjectQueue(OUTGOING_QUEUE) private readonly outgoingQueue: Queue<OutgoingJob>,
    @InjectQueue(RESPOND_QUEUE) private readonly respondQueue: Queue<RespondJob>,
  ) {}

  /**
   * Encola el webhook entrante para procesarlo en segundo plano con reintentos
   * (lo llama el controlador del webhook, que responde 200 al instante).
   */
  async enqueueIncoming(payload: Record<string, unknown>) {
    await this.incomingQueue.add('incoming', payload, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 200,
    });
  }

  /**
   * Punto de entrada del webhook de mensajería. Se ejecuta en segundo plano
   * (el webhook responde 200 al instante) y nunca lanza: registra los errores.
   */
  async handleIncoming(rawPayload: Record<string, unknown>): Promise<void> {
    try {
      const payload = normalizeBody(rawPayload);

      const event = String(payload.event ?? payload.event_type ?? '').toLowerCase();
      if (
        event.includes('read') ||
        event.includes('delivered') ||
        event.includes('reaction')
      ) {
        return;
      }

      const accountId = String(payload.account_id ?? '');
      const chatId = String(payload.chat_id ?? payload.chat ?? '');
      if (!accountId || !chatId) {
        this.logger.debug(`Webhook sin account/chat. Claves: ${Object.keys(payload).join(', ')}`);
        return;
      }

      const channel = await this.findChannel(accountId);
      if (!channel) {
        this.logger.warn(`Mensaje de cuenta desconocida ${accountId}; ignorado`);
        return;
      }
      const orgId = channel.organization_id as string;

      // Leemos el último mensaje directamente de Unipile: así no dependemos del
      // formato exacto del webhook (que varía) para el texto y el remitente.
      const evt = await this.resolveIncoming(payload, accountId, chatId);
      if (!evt) return;

      const conv = await this.upsertConversation(orgId, channel, evt);

      // Anti-duplicado: si ya guardamos este mensaje, no lo procesamos otra vez.
      if (evt.messageId && (await this.messageExists(conv.id, evt.messageId))) {
        return;
      }

      await this.supabase.admin.from('messages').insert({
        conversation_id: conv.id,
        organization_id: orgId,
        role: 'contact',
        content: evt.text,
        metadata: { message_id: evt.messageId ?? null },
      });
      await this.supabase.admin
        .from('conversations')
        .update({
          last_inbound_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          unread_count: (conv.unread_count ?? 0) + 1,
          contact_name: evt.senderName ?? conv.contact_name,
          contact_handle: evt.senderProviderId ?? conv.contact_handle,
        })
        .eq('id', conv.id);

      // Atribución: si el lead viene de un anuncio click-to-WhatsApp, el primer
      // mensaje trae un `referral`. Lo guardamos una sola vez (origen del lead).
      await this.captureReferral(orgId, conv.id, rawPayload);

      await this.scheduleResponse(orgId, conv.id, evt.chatId, channel.provider as string);
    } catch (err) {
      this.logger.error(`Error procesando mensaje entrante: ${String(err)}`);
    }
  }

  /**
   * Extrae y persiste (una sola vez) el `referral` de un anuncio click-to-WhatsApp.
   * Meta lo incluye en el PRIMER mensaje entrante de la conversación. Guardamos
   * `referral` + marcamos `source='ctwa'` y `campaign` para enrutar/atribuir.
   */
  private async captureReferral(orgId: string, conversationId: string, payload: Record<string, unknown>) {
    try {
      const referral = extractReferral(payload);
      if (!referral) return;
      await this.supabase.admin
        .from('conversations')
        .update({
          referral,
          source: 'ctwa',
          source_detail: referral.source_url ?? null,
          campaign: referral.source_id ?? null,
        })
        .eq('id', conversationId)
        .eq('organization_id', orgId)
        .is('referral', null); // solo en el primer mensaje (no sobrescribe)
    } catch (err) {
      this.logger.warn(`No se pudo guardar el referral del anuncio: ${String(err)}`);
    }
  }

  /**
   * Ingesta de un mensaje entrante por WhatsApp Cloud API (capa oficial Meta).
   * Lo llama el webhook de Meta tras verificar la firma. Crea/recupera la
   * conversación (transport=whatsapp_cloud, modo setter porque viene de anuncio),
   * guarda el mensaje, captura el referral del anuncio y programa la respuesta.
   */
  async handleCloudInbound(params: {
    phoneNumberId: string;
    from: string;
    text: string;
    messageId?: string;
    name?: string;
    referral?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      const { data: channel } = await this.supabase.admin
        .from('channels')
        .select('id, organization_id, provider')
        .eq('cloud_phone_number_id', params.phoneNumberId)
        .maybeSingle();
      if (!channel) {
        this.logger.warn(`Cloud API: phone_number_id desconocido ${params.phoneNumberId}`);
        return;
      }
      const orgId = channel.organization_id as string;
      const handle = `+${params.from.replace(/[^\d]/g, '')}`;

      // Conversación por contacto en el canal (clave: contact_external_id = from).
      const { data: existing } = await this.supabase.admin
        .from('conversations')
        .select('id, contact_name, unread_count, referral')
        .eq('organization_id', orgId)
        .eq('channel_id', channel.id)
        .eq('contact_external_id', params.from)
        .eq('is_test', false)
        .maybeSingle();

      let convId: string;
      if (existing) {
        convId = existing.id as string;
      } else {
        const { data: created, error } = await this.supabase.admin
          .from('conversations')
          .insert({
            organization_id: orgId,
            channel_id: channel.id,
            provider: 'whatsapp',
            transport: 'whatsapp_cloud',
            contact_external_id: params.from,
            contact_handle: handle,
            contact_name: params.name ?? 'Lead',
            source: params.referral ? 'ctwa' : 'whatsapp',
            mode: 'setter',
            mode_locked: true,
            ai_enabled: true,
            consent_optin: true,
            is_test: false,
            stage: 'new',
          })
          .select('id')
          .single();
        if (error) throw error;
        convId = created.id as string;
      }

      if (params.messageId && (await this.messageExists(convId, params.messageId))) return;

      await this.supabase.admin.from('messages').insert({
        conversation_id: convId,
        organization_id: orgId,
        role: 'contact',
        content: params.text,
        metadata: { message_id: params.messageId ?? null, transport: 'whatsapp_cloud' },
      });
      await this.supabase.admin
        .from('conversations')
        .update({
          last_inbound_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          unread_count: ((existing?.unread_count as number) ?? 0) + 1,
          contact_name: params.name ?? existing?.contact_name ?? 'Lead',
          window_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        })
        .eq('id', convId);

      if (params.referral) {
        await this.supabase.admin
          .from('conversations')
          .update({
            referral: params.referral,
            source: 'ctwa',
            source_detail: (params.referral.source_url as string) ?? null,
            campaign: (params.referral.source_id as string) ?? null,
          })
          .eq('id', convId)
          .is('referral', null);
      }

      await this.scheduleResponse(orgId, convId, params.from, 'whatsapp');
    } catch (err) {
      this.logger.error(`Error en ingesta Cloud API: ${String(err)}`);
    }
  }

  /**
   * Programa (o reprograma) la respuesta agrupada de una conversación. Cada
   * mensaje nuevo del lead reinicia la ventana de debounce: así juntamos varios
   * mensajes seguidos en UNA sola respuesta y nunca corremos dos a la vez.
   */
  private async scheduleResponse(
    orgId: string,
    conversationId: string,
    chatId: string,
    provider: string,
  ) {
    // OJO: BullMQ NO permite ':' en los jobId personalizados ("Custom Id cannot
    // contain :"). Usamos '-' o el job fallaría y el bot no respondería nunca.
    const jobId = `respond-${conversationId}`;
    // Quitamos el job pendiente anterior (si lo hay) para reiniciar el temporizador.
    try {
      const existing = await this.respondQueue.getJob(jobId);
      if (existing) await existing.remove();
    } catch {
      // Si está en ejecución no se puede borrar: ese job abortará solo al detectar
      // que ha llegado un mensaje más nuevo (watermark).
    }
    await this.respondQueue.add(
      'respond',
      { orgId, conversationId, chatId, provider },
      {
        jobId,
        delay: DEBOUNCE_MS,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  /**
   * Determina el texto/remitente del mensaje entrante. Intenta leer el último
   * mensaje del chat en Unipile; si falla, cae al contenido del propio webhook.
   */
  private async resolveIncoming(
    payload: Record<string, unknown>,
    accountId: string,
    chatId: string,
  ): Promise<IncomingEvent | null> {
    const senderName = extractSenderName(payload);
    const senderProviderId = extractSenderProviderId(payload);

    try {
      const msgs = await this.unipile.listChatMessages(chatId, 3);
      const sorted = [...msgs].sort(
        (a, b) => msgTime(b) - msgTime(a),
      );
      const latest = sorted[0];
      if (latest) {
        // Si el último mensaje lo enviamos nosotros, no respondemos (evita bucle).
        if (latest.is_sender === 1 || latest.is_sender === true) return null;
        const text = (latest.text ?? '').trim();
        if (text) {
          return {
            accountId,
            chatId,
            text,
            messageId: latest.id ? String(latest.id) : undefined,
            senderName,
            senderProviderId,
          };
        }
      }
    } catch (err) {
      this.logger.warn(`No se pudo leer el chat en Unipile: ${String(err)}`);
    }

    // Fallback: texto del propio webhook.
    const text = extractText(payload);
    if (!text) {
      this.logger.debug(`Webhook sin texto. Claves: ${Object.keys(payload).join(', ')}`);
      return null;
    }
    return {
      accountId,
      chatId,
      text,
      messageId: payload.message_id ? String(payload.message_id) : undefined,
      senderName,
      senderProviderId,
    };
  }

  private async messageExists(convId: string, messageId: string): Promise<boolean> {
    const { data } = await this.supabase.admin
      .from('messages')
      .select('id')
      .eq('conversation_id', convId)
      .eq('metadata->>message_id', messageId)
      .maybeSingle();
    return Boolean(data);
  }

  /** Envía un mensaje manual del agente humano y lo registra. Pausa la IA. */
  async sendAgentMessage(orgId: string, conversationId: string, text: string) {
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('id, unipile_chat_id, channel_id, transport')
      .eq('id', conversationId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!conv) throw new Error('Conversación no encontrada');

    if (conv.unipile_chat_id) {
      await this.transport.sendText({
        transport: conv.transport as string,
        chatId: conv.unipile_chat_id as string,
        text,
      });
    }

    await this.supabase.admin.from('messages').insert({
      conversation_id: conversationId,
      organization_id: orgId,
      role: 'agent',
      content: text,
    });
    await this.supabase.admin
      .from('conversations')
      .update({
        last_outbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        ai_enabled: false, // al escribir manualmente, la IA se pausa (como SkaleX)
      })
      .eq('id', conversationId);

    return { ok: true };
  }

  // ---------------------------------------------------------------------------

  /**
   * Genera y envía la respuesta agrupada de una conversación (lo ejecuta el
   * worker del RESPOND_QUEUE tras la ventana de debounce). Reglas clave:
   *  - Una sola respuesta por tanda de mensajes (ya agrupados por el debounce).
   *  - Antes de cada burbuja comprueba si llegó un mensaje MÁS NUEVO (watermark):
   *    si es así, aborta y deja que la nueva tanda conteste con todo el contexto.
   *  - Persiste cada burbuja SOLO cuando se envía (BD y WhatsApp van sincronizados).
   */
  async generateAndSend(job: RespondJob) {
    const { orgId, conversationId, chatId, provider } = job;

    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select(
        'id, ai_enabled, blocked, mode, mode_locked, contact_name, contact_external_id, contact_handle, last_inbound_at, transport, channel_id',
      )
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv || !conv.ai_enabled || conv.blocked) return;

    const cfg = await this.setterConfig.getOrCreate(orgId);
    if (!cfg.is_active) return;

    for (const id of [conv.contact_external_id, conv.contact_handle].filter(Boolean) as string[]) {
      if (await this.silenced.isSilenced(orgId, id)) {
        this.logger.log(`Contacto silenciado ${id}; no se responde`);
        return;
      }
    }

    if (cfg.active_hours_enabled && !inActiveHours(cfg.active_hours_start, cfg.active_hours_end)) {
      this.logger.log('Fuera de horario; no se responde');
      return;
    }

    // Solo respondemos si el último mensaje es del contacto (no contestar a lo
    // nuestro ni a tandas ya respondidas).
    const { data: last } = await this.supabase.admin
      .from('messages')
      .select('role')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last || last.role !== 'contact') return;

    // Clasificación (una vez) por si aún no tiene modo.
    let mode = conv.mode as string;
    if (mode === 'unclassified' && !conv.mode_locked) {
      mode = await this.classifier.classify(orgId, chatId, provider);
      await this.supabase.admin.from('conversations').update({ mode }).eq('id', conversationId);
      this.logger.log(`Conversación ${conversationId} clasificada como: ${mode}`);
    }
    if (mode === 'ignored') return;

    // Marca de agua: el momento del último mensaje entrante AHORA. Si durante el
    // envío entra uno más nuevo, abortamos.
    const watermark = conv.last_inbound_at ?? null;

    const respondMode = mode === 'support' ? 'support' : 'setter';
    const bubbles = await this.setter.respond(orgId, conversationId, respondMode, {
      contactName: conv.contact_name,
      persist: false,
    });
    if (bubbles.length === 0) return;

    // Retardo inicial (simula "leer"). El cps/longitud da el ritmo entre burbujas.
    await sleep(randomSeconds(cfg.first_reply_min_s, cfg.first_reply_max_s) * 1000);

    for (const b of bubbles) {
      if (await this.newerInboundExists(conversationId, watermark)) {
        this.logger.log(`Llegó un mensaje nuevo; abortando respuesta vieja (${conversationId})`);
        return;
      }
      await sleep(b.delayMs);
      if (await this.newerInboundExists(conversationId, watermark)) {
        this.logger.log(`Llegó un mensaje nuevo; abortando respuesta vieja (${conversationId})`);
        return;
      }

      try {
        await this.transport.sendText({
          transport: conv.transport as string,
          chatId,
          text: b.content,
          channelId: conv.channel_id as string | null,
          to: (conv.contact_handle ?? conv.contact_external_id) as string | null,
        });
      } catch (err) {
        this.logger.error(`No se pudo enviar la burbuja: ${String(err)}`);
        return;
      }
      await this.supabase.admin.from('messages').insert({
        conversation_id: conversationId,
        organization_id: orgId,
        role: 'assistant',
        content: b.content,
      });
      await this.supabase.admin
        .from('conversations')
        .update({ last_outbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
    }

    // Tras responder, el bot comprueba si el lead ha agendado/confirmado una
    // llamada y, si es así, etiqueta la conversación como `call_scheduled`.
    void this.appointmentDetector.maybeDetect(orgId, conversationId);
  }

  /** ¿Ha entrado un mensaje del contacto más nuevo que la marca de agua? */
  private async newerInboundExists(conversationId: string, watermark: string | null): Promise<boolean> {
    const { data } = await this.supabase.admin
      .from('conversations')
      .select('last_inbound_at')
      .eq('id', conversationId)
      .maybeSingle();
    const current = data?.last_inbound_at ?? null;
    if (!current) return false;
    if (!watermark) return true;
    return new Date(current).getTime() > new Date(watermark).getTime();
  }

  /** Envía una burbuja (lo ejecuta el worker de la cola "outgoing"). */
  async deliverOutgoing(job: OutgoingJob) {
    if (job.kind === 'proactive') {
      await this.deliverProactive(job);
      return;
    }
    if (!job.chatId) return;
    await this.transport.sendText({ transport: job.transport, chatId: job.chatId, text: job.content });
    await this.supabase.admin
      .from('conversations')
      .update({ last_outbound_at: new Date().toISOString() })
      .eq('id', job.conversationId);
  }

  /**
   * Encola el PRIMER mensaje proactivo a un lead, con throttling: se reparten
   * los envíos en el tiempo (espaciado con jitter) y se respeta el horario
   * activo, para proteger el número de WhatsApp de baneos.
   */
  async enqueueProactive(params: {
    orgId: string;
    conversationId: string;
    accountId: string;
    attendeeId: string;
    content: string;
    transport?: string;
  }): Promise<{ delayMs: number }> {
    const cfg = await this.setterConfig.getOrCreate(params.orgId);
    const spacingMs = randomSeconds(40, 100) * 1000;

    const client = await this.outgoingQueue.client;
    const key = `proactive:nextslot:${params.orgId}`;
    const now = Date.now();

    // Reservamos un "hueco" por organización para no enviar todo de golpe.
    const stored = Number((await client.get(key)) ?? 0);
    let slot = Math.max(stored, now);
    slot = nextActiveSlot(slot, cfg.active_hours_enabled, cfg.active_hours_start, cfg.active_hours_end);
    // Guardamos el próximo hueco libre (timestamp). Se auto-acota con Math.max.
    await client.set(key, String(slot + spacingMs));

    const delay = Math.max(0, slot - now);
    await this.outgoingQueue.add(
      'send',
      {
        kind: 'proactive',
        orgId: params.orgId,
        conversationId: params.conversationId,
        accountId: params.accountId,
        attendeeId: params.attendeeId,
        content: params.content,
        transport: params.transport,
      },
      { delay, attempts: 3, backoff: { type: 'fixed', delay: 5000 }, removeOnComplete: true, removeOnFail: 200 },
    );
    return { delayMs: delay };
  }

  private async deliverProactive(job: OutgoingJob) {
    if (!job.accountId || !job.attendeeId) return;
    // Evita duplicar si ya se contactó (reintentos / carreras).
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('proactive_sent')
      .eq('id', job.conversationId)
      .maybeSingle();
    if (conv?.proactive_sent) return;

    const { chatId } = await this.transport.startChat({
      transport: job.transport,
      accountId: job.accountId,
      recipientId: job.attendeeId,
      text: job.content,
    });

    await this.supabase.admin.from('messages').insert({
      conversation_id: job.conversationId,
      organization_id: job.orgId,
      role: 'assistant',
      content: job.content,
      metadata: { proactive: true },
    });
    await this.supabase.admin
      .from('conversations')
      .update({
        proactive_sent: true,
        unipile_chat_id: chatId,
        contact_external_id: chatId,
        last_outbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      })
      .eq('id', job.conversationId);
    this.logger.log(`Primer mensaje proactivo enviado (conv ${job.conversationId})`);
  }

  private async findChannel(accountId: string) {
    const { data } = await this.supabase.admin
      .from('channels')
      .select('id, organization_id, provider')
      .eq('unipile_account_id', accountId)
      .maybeSingle();
    return data;
  }

  private async upsertConversation(
    orgId: string,
    channel: { id: string; provider: string },
    evt: IncomingEvent,
  ) {
    const { data: existing } = await this.supabase.admin
      .from('conversations')
      .select('id, ai_enabled, mode, mode_locked, contact_name, contact_external_id, contact_handle, unread_count')
      .eq('organization_id', orgId)
      .eq('channel_id', channel.id)
      .eq('contact_external_id', evt.chatId)
      .eq('is_test', false)
      .maybeSingle();

    if (existing) return existing;

    const { data: created, error } = await this.supabase.admin
      .from('conversations')
      .insert({
        organization_id: orgId,
        channel_id: channel.id,
        provider: channel.provider,
        contact_external_id: evt.chatId,
        unipile_chat_id: evt.chatId,
        contact_handle: evt.senderProviderId ?? null,
        contact_name: evt.senderName ?? 'Lead',
        is_test: false,
        ai_enabled: true,
        stage: 'new',
      })
      .select('id, ai_enabled, mode, mode_locked, contact_name, contact_external_id, contact_handle, unread_count')
      .single();
    if (error) throw error;
    return created;
  }

}

/**
 * Algunos webhooks llegan con un content-type que Express parsea mal y dejan
 * todo el JSON como una única clave. Lo detectamos y reparseamos.
 */
function normalizeBody(body: Record<string, unknown>): Record<string, unknown> {
  if (body && typeof body === 'object' && body.account_id === undefined) {
    const keys = Object.keys(body);
    if (keys.length === 1 && keys[0].trim().startsWith('{')) {
      try {
        return JSON.parse(keys[0]) as Record<string, unknown>;
      } catch {
        // se queda como está
      }
    }
  }
  return body;
}

function extractText(payload: Record<string, unknown>): string {
  const message = payload.message;
  if (typeof message === 'string') return message.trim();
  if (typeof payload.text === 'string') return payload.text.trim();
  const nested = (message as Record<string, unknown>)?.text;
  return typeof nested === 'string' ? nested.trim() : '';
}

function extractSenderName(payload: Record<string, unknown>): string | undefined {
  const sender = (payload.sender ?? {}) as Record<string, unknown>;
  if (sender.attendee_name) return String(sender.attendee_name);
  const attendees = payload.attendees;
  if (Array.isArray(attendees)) {
    const other = attendees.find(
      (a) => a && typeof a === 'object' && !(a as Record<string, unknown>).is_self,
    ) as Record<string, unknown> | undefined;
    if (other?.attendee_name) return String(other.attendee_name);
    if (other?.name) return String(other.name);
  }
  return undefined;
}

/**
 * Datos del anuncio de origen (click-to-WhatsApp). El formato exacto varía según
 * el transporte (Cloud API oficial: `messages[0].referral`; Unipile: dentro del
 * mensaje/contexto). Buscamos de forma defensiva en varias rutas conocidas.
 */
export type AdReferral = {
  ctwa_clid?: string | null;
  source_id?: string | null;
  source_url?: string | null;
  source_type?: string | null;
  headline?: string | null;
};

function extractReferral(payload: Record<string, unknown>): AdReferral | null {
  const body = normalizeBody(payload);
  const candidates: unknown[] = [
    body.referral,
    (body.message as Record<string, unknown>)?.referral,
    ((body.message as Record<string, unknown>)?.context as Record<string, unknown>)?.referral,
    (body.context as Record<string, unknown>)?.referral,
    (Array.isArray(body.messages) ? (body.messages[0] as Record<string, unknown>) : undefined)?.referral,
  ];

  for (const c of candidates) {
    if (c && typeof c === 'object') {
      const r = c as Record<string, unknown>;
      const ref: AdReferral = {
        ctwa_clid: str(r.ctwa_clid),
        source_id: str(r.source_id),
        source_url: str(r.source_url),
        source_type: str(r.source_type),
        headline: str(r.headline),
      };
      // Solo lo consideramos válido si trae algún identificador útil.
      if (ref.ctwa_clid || ref.source_id || ref.source_url) return ref;
    }
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function extractSenderProviderId(payload: Record<string, unknown>): string | undefined {
  const sender = (payload.sender ?? {}) as Record<string, unknown>;
  if (sender.attendee_provider_id) return String(sender.attendee_provider_id);
  return undefined;
}

function msgTime(m: { timestamp?: string; date?: string }): number {
  const raw = m.timestamp ?? m.date;
  const t = raw ? new Date(raw).getTime() : 0;
  return isNaN(t) ? 0 : t;
}

function randomSeconds(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function inActiveHours(start: number, end: number): boolean {
  const hour = new Date().getUTCHours();
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Devuelve el momento (ms) en que se puede enviar respetando el horario activo.
 * Si la franja está desactivada o ya estamos dentro, devuelve `slotMs` tal cual;
 * si no, lo empuja al inicio de la próxima franja activa (en UTC).
 */
function nextActiveSlot(
  slotMs: number,
  enabled: boolean,
  start: number,
  end: number,
): number {
  if (!enabled) return slotMs;
  const d = new Date(slotMs);
  const hour = d.getUTCHours();
  const inside = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  if (inside) return slotMs;

  const next = new Date(d);
  next.setUTCMinutes(0, 0, 0);
  // Avanzamos hora a hora hasta entrar en la franja (máx 48 iteraciones).
  for (let i = 0; i < 48; i++) {
    next.setUTCHours(next.getUTCHours() + 1);
    const h = next.getUTCHours();
    const ok = start <= end ? h >= start && h < end : h >= start || h < end;
    if (ok) return next.getTime();
  }
  return slotMs;
}
