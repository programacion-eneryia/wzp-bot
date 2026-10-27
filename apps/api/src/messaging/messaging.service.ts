import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { UnipileService, type UnipileAttachment } from '../unipile/unipile.service';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { SetterService } from '../setter/setter.service';
import { SetterConfigService } from '../setter/setter-config.service';
import { SilencedContactsService } from '../setter/silenced-contacts.service';
import { ConversationClassifierService } from '../setter/conversation-classifier.service';
import { AppointmentDetectorService } from '../calendar/appointment-detector.service';
import { TransportService } from './transport.service';
import { TagClassifierService } from '../tags/tag-classifier.service';
import { WorkflowTriggerService } from '../workflows/workflow-trigger.service';
import { AgentsService } from '../agents/agents.service';
import { effectiveBehavior, type Agent } from '../agents/agents.types';
import { StagesService } from '../stages/stages.service';
import { GhlSyncService } from '../ghl/ghl-sync.service';
import { ErrorLogService } from '../platform/error-log.service';
import { newConversationsStartPaused } from '../common/flags';
import {
  betterName,
  isPlaceholderName,
  phoneFromJid,
  phoneOfAttendee,
  phoneVariants,
  samePhone,
  toE164,
  whatsappDigits,
} from '../common/phone';
import { DEBOUNCE_MS, type OutgoingJob, type RespondJob } from './queues';

/** Margen tras registrar un lead en el que su primer mensaje saliente se toma como la plantilla de GHL. */
const FIRST_CONTACT_WINDOW_MS = 60 * 60_000;
const ECHO_GRACE_MS = 5_000;
/** Reintentos (cada ECHO_GRACE_MS) esperando al lead cuando su plantilla llega antes. */
const ECHO_LEAD_WAIT_TRIES = 3;
/** Antigüedad máxima de un chat para vincularlo a un lead que acaba de entrar. */
const RECENT_CHAT_MS = 30 * 60_000;
/** Una plantilla de primer contacto más antigua que esto ya no arranca seguimientos. */
const FIRST_CONTACT_FOLLOWUP_WINDOW_MS = 24 * 60 * 60_000;
const RESPOND_RETRY_MS = 10 * 60_000;
const RESPOND_RETRY_WINDOW_MS = 24 * 60 * 60_000;
const FOLLOWUP_BATCH = 10;
/** Etapas en las que ya no tiene sentido perseguir al lead. */
// Etapas que cierran el seguimiento. "No cualificado" NO está: un lead puede
// volver a escribir meses después y la conversación revive; si no procede
// insistir, el modelo responde NO_SEGUIMIENTO con el contexto delante.
const FOLLOWUP_STOP_STAGES = new Set(['call_scheduled', 'won', 'lost']);
/** Al recibir un mensaje del lead, el ciclo de seguimiento se reinicia. */
const FOLLOWUP_RESET = { next_followup_at: null, followup_count: 0 } as const;

const CONV_COLS =
  'id, ai_enabled, mode, mode_locked, contact_name, contact_external_id, contact_handle, unread_count';

/** Lock obsoleto: si una respuesta/envío quedó "en curso" más de esto, se reclama. */
const LOCK_STALE_MS = 3 * 60 * 1000;
/** Cuántas conversaciones/mensajes procesa cada tick del cron como máximo. */
// Lotes por tick de cron. Se procesan EN PARALELO (cada trabajo toma su propio
// lock atómico), así que el techo por minuto ≈ tamaño del lote. Subirlos aumenta
// el rendimiento a cambio de más llamadas concurrentes a la IA / al proveedor.
const RESPOND_BATCH = 25;
const OUTBOX_BATCH = 30;
const OUTBOX_MAX_ATTEMPTS = 6;

type IncomingEvent = {
  accountId: string;
  chatId: string;
  text: string;
  messageId?: string;
  senderName?: string;
  senderProviderId?: string;
  /** El mensaje salió de NUESTRA cuenta (eco): bot, agente o humano en el móvil. */
  fromSelf?: boolean;
};

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly unipile: UnipileService,
    private readonly openrouter: OpenRouterService,
    private readonly setter: SetterService,
    private readonly setterConfig: SetterConfigService,
    private readonly silenced: SilencedContactsService,
    private readonly classifier: ConversationClassifierService,
    private readonly appointmentDetector: AppointmentDetectorService,
    private readonly transport: TransportService,
    private readonly tagClassifier: TagClassifierService,
    private readonly workflowTrigger: WorkflowTriggerService,
    private readonly agents: AgentsService,
    private readonly stages: StagesService,
    private readonly ghlSync: GhlSyncService,
    private readonly errorLog: ErrorLogService,
  ) {}

  /**
   * Procesa el webhook entrante. En el modelo serverless (Vercel) no hay worker
   * persistente: guardamos el mensaje aquí mismo (la función responde 200 tras
   * ello) y dejamos la GENERACIÓN de la respuesta para el cron, que la envía
   * cuando vence la ventana de debounce (`respond_after`).
   */
  async enqueueIncoming(payload: Record<string, unknown>) {
    await this.handleIncoming(payload);
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

      // Eco de un mensaje SALIENTE de nuestra cuenta: si no lo envió el bot ni
      // un agente desde el portal, es un humano respondiendo desde el móvil /
      // WhatsApp Business → pausamos la IA (human takeover).
      if (evt.fromSelf) {
        await this.handleOwnOutboundEcho(orgId, channel, evt);
        return;
      }

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
      const contactUpdate: Record<string, unknown> = {};
      const name = betterName(conv.contact_name as string | null, evt.senderName);
      if (name) contactUpdate.contact_name = name;
      // El handle solo se cambia por un teléfono real, nunca por un id `@lid`.
      const phone = phoneFromJid(evt.senderProviderId);
      if (phone && phone !== conv.contact_handle) contactUpdate.contact_handle = phone;
      else if (!conv.contact_handle && evt.senderProviderId) {
        contactUpdate.contact_handle = evt.senderProviderId;
      }
      await this.supabase.admin
        .from('conversations')
        .update({
          last_inbound_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          unread_count: (conv.unread_count ?? 0) + 1,
          ...FOLLOWUP_RESET,
          ...contactUpdate,
        })
        .eq('id', conv.id);

      // Atribución: si el lead viene de un anuncio click-to-WhatsApp, el primer
      // mensaje trae un `referral`. Lo guardamos una sola vez (origen del lead).
      await this.captureReferral(orgId, conv.id, rawPayload);

      // El lead respondió: pausamos los seguimientos del workflow (la IA setter
      // toma el relevo). Se reanudan solos si vuelve a quedarse en silencio.
      await this.pauseWorkflowRuns(conv.id);

      await this.scheduleResponse(orgId, conv.id, evt.chatId, channel.provider as string);

      // Si la IA está desactivada (chat llevado por una persona), etiquetamos
      // aquí; si está activa, lo hará el hook tras la respuesta del bot.
      if (!conv.ai_enabled) void this.tagClassifier.maybeTag(orgId, conv.id as string);
    } catch (err) {
      const reason = err instanceof Error ? err.stack ?? err.message : String(err);
      this.logger.error(`Error procesando mensaje entrante: ${reason}`);
      void this.errorLog.log({
        source: 'webhook',
        message: `Error procesando mensaje entrante: ${reason.slice(0, 1500)}`,
        detail: { payload: truncateForLog(rawPayload) },
      });
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
        const initial = await this.agents.initialForConversation(orgId, channel.id as string);
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
            ai_enabled: initial.ai_enabled && !newConversationsStartPaused(),
            consent_optin: true,
            is_test: false,
            stage: initial.stage,
          })
          .select('id')
          .single();
        if (error) throw error;
        convId = created.id as string;
        void this.workflowTrigger.fire(orgId, convId, 'conversation_created');
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
          ...FOLLOWUP_RESET,
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

      await this.pauseWorkflowRuns(convId);
      await this.scheduleResponse(orgId, convId, params.from, 'whatsapp');
    } catch (err) {
      this.logger.error(`Error en ingesta Cloud API: ${String(err)}`);
    }
  }

  /**
   * Programa (o reprograma) la respuesta agrupada de una conversación. Cada
   * mensaje nuevo del lead empuja hacia adelante la ventana de debounce
   * (`respond_after = now + DEBOUNCE_MS`): así juntamos varios mensajes seguidos
   * en UNA sola respuesta. El cron recoge las conversaciones ya vencidas.
   */
  private async scheduleResponse(
    orgId: string,
    conversationId: string,
    _chatId: string,
    _provider: string,
  ) {
    void orgId;
    await this.supabase.admin
      .from('conversations')
      .update({ respond_after: new Date(Date.now() + DEBOUNCE_MS).toISOString() })
      .eq('id', conversationId);
  }

  // ---------------------------------------------------------------------------
  //  CRON: drena las conversaciones vencidas y el outbox proactivo.
  //  Lo invoca /api/cron/tick (Vercel) y el scheduler local en desarrollo.
  // ---------------------------------------------------------------------------

  /**
   * Procesa las conversaciones cuya ventana de debounce ya venció: para cada una
   * genera y envía la respuesta. Devuelve cuántas trató.
   */
  async processDueResponses(limit = RESPOND_BATCH): Promise<number> {
    const nowIso = new Date().toISOString();
    const { data: due } = await this.supabase.admin
      .from('conversations')
      .select('id, organization_id, provider, unipile_chat_id, contact_external_id')
      .lte('respond_after', nowIso)
      .not('respond_after', 'is', null)
      .eq('ai_enabled', true)
      .eq('blocked', false)
      .order('respond_after', { ascending: true })
      .limit(limit);

    if (!due || due.length === 0) return 0;

    // En paralelo: cada conversación se responde por su cuenta y toma su lock
    // atómico (`responding_lock_at`) dentro de generateAndSend, así que no hay
    // carreras. Antes era secuencial y los retardos de "escritura" limitaban el
    // throughput a ~1 conversación cada varios segundos.
    const results = await Promise.allSettled(
      due.map((conv) =>
        this.generateAndSend({
          orgId: conv.organization_id as string,
          conversationId: conv.id as string,
          chatId: (conv.unipile_chat_id ?? conv.contact_external_id) as string,
          provider: conv.provider as string,
        }),
      ),
    );
    let handled = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') handled++;
      else this.logger.error(`Error respondiendo conv ${due[i].id}: ${String(r.reason)}`);
    });
    return handled;
  }

  /** Envía los mensajes proactivos del outbox que ya están vencidos. */
  async processDueOutbox(limit = OUTBOX_BATCH): Promise<number> {
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - LOCK_STALE_MS).toISOString();
    const { data: rows } = await this.supabase.admin
      .from('outbox')
      .select('id, organization_id, conversation_id, kind, transport, account_id, attendee_id, chat_id, content, attempts')
      .is('sent_at', null)
      .lte('send_after', nowIso)
      .or(`locked_at.is.null,locked_at.lt.${staleIso}`)
      .order('send_after', { ascending: true })
      .limit(limit);

    if (!rows || rows.length === 0) return 0;

    // En paralelo: cada fila toma su lock atómico antes de enviarse, así que dos
    // ticks solapados nunca envían el mismo mensaje dos veces.
    const results = await Promise.allSettled(
      rows.map(async (row) => {
        // Lock atómico: solo procede quien logra marcar locked_at.
        const { data: locked } = await this.supabase.admin
          .from('outbox')
          .update({ locked_at: nowIso, attempts: ((row.attempts as number | null) ?? 0) + 1 })
          .eq('id', row.id)
          .is('sent_at', null)
          .or(`locked_at.is.null,locked_at.lt.${staleIso}`)
          .select('id')
          .maybeSingle();
        if (!locked) return false;

        try {
          await this.deliverOutgoing({
            kind: (row.kind as 'proactive' | 'reply') ?? 'proactive',
            orgId: row.organization_id as string,
            conversationId: row.conversation_id as string,
            transport: (row.transport as string) ?? undefined,
            accountId: (row.account_id as string) ?? undefined,
            attendeeId: (row.attendee_id as string) ?? undefined,
            chatId: (row.chat_id as string) ?? undefined,
            content: row.content as string,
          });
          await this.supabase.admin
            .from('outbox')
            .update({ sent_at: new Date().toISOString(), locked_at: null })
            .eq('id', row.id);
          return true;
        } catch (err) {
          // Reintento cada 15 min; tras OUTBOX_MAX_ATTEMPTS se aparca (send_after
          // nulo) con el error a la vista en vez de insistir para siempre.
          const attempts = ((row.attempts as number | null) ?? 0) + 1;
          await this.supabase.admin
            .from('outbox')
            .update({
              locked_at: null,
              last_error: String(err),
              send_after:
                attempts >= OUTBOX_MAX_ATTEMPTS ? null : new Date(Date.now() + 15 * 60_000).toISOString(),
            })
            .eq('id', row.id);
          this.logger.error(`Error enviando outbox ${row.id}: ${String(err)}`);
          void this.errorLog.log({
            source: 'outbox',
            message: `No se pudo enviar un mensaje programado (conv ${String(row.conversation_id)}, intento ${attempts}): ${String(err).slice(0, 800)}`,
            organizationId: row.organization_id as string,
          });
          return false;
        }
      }),
    );
    return results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
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

    // Si el propio webhook indica que el mensaje lo enviamos NOSOTROS, no
    // respondemos (evita bucles), pero lo devolvemos marcado como eco: puede
    // ser un humano escribiendo desde el móvil (human takeover).
    if (isFromSelf(payload)) {
      const echoText = extractText(payload);
      if (!echoText) return null;
      return {
        accountId,
        chatId,
        text: echoText,
        messageId: payload.message_id ? String(payload.message_id) : undefined,
        senderName,
        senderProviderId,
        fromSelf: true,
      };
    }

    // Texto e id que viajan EN el webhook. Es la fuente fiable: no depende de que
    // la lista de mensajes de Unipile ya refleje el mensaje (esa lectura puede ir
    // con retraso y hacía que se descartaran mensajes reales del lead).
    const payloadText = extractText(payload);
    const payloadId = payload.message_id ? String(payload.message_id) : undefined;

    // Lectura best-effort de Unipile. La usamos SOLO para: (a) recuperar el texto
    // si el webhook no lo trajo, y (b) descartar ecos de mensajes nuestros (el
    // último de Unipile es nuestro y coincide el texto).
    let latestIsSelf = false;
    let latestText = '';
    let latestId: string | undefined;
    let latestAttachments: UnipileAttachment[] = [];
    try {
      const msgs = await this.unipile.listChatMessages(chatId, 3);
      const latest = [...msgs].sort((a, b) => msgTime(b) - msgTime(a))[0];
      if (latest) {
        latestIsSelf = latest.is_sender === 1 || latest.is_sender === true;
        latestText = (latest.text ?? '').trim();
        latestId = latest.id ? String(latest.id) : undefined;
        latestAttachments = latest.attachments ?? [];
      }
    } catch (err) {
      this.logger.warn(`No se pudo leer el chat en Unipile: ${String(err)}`);
    }

    let text = payloadText || (!latestIsSelf ? latestText : '');
    if (!text) {
      // Sin texto: puede ser una nota de voz, una imagen, un documento… Antes se
      // descartaba y el bot se quedaba callado. Ahora lo describimos (y el audio
      // se transcribe) para que la conversación siga.
      // El webhook nombra los campos distinto que la API (`attachment_id`,
      // `attachment_type`…): los normalizamos.
      let atts = normalizeAttachments(payload.attachments);
      let msgId = payloadId ?? latestId;
      // Fuente fiable: el propio mensaje por id. La lista del chat puede ir con
      // retraso (y entonces el "último" sería nuestro) y el webhook puede venir
      // sin adjuntos o sin su mimetype. Si el mensaje es nuestro, es un eco sin
      // texto: fuera.
      if (payloadId) {
        try {
          const full = await this.unipile.getMessage(payloadId);
          if (full.is_sender === 1 || full.is_sender === true) return null;
          const fullText = (full.text ?? '').trim();
          if (fullText) text = fullText;
          if (full.attachments?.length) atts = normalizeAttachments(full.attachments);
          msgId = payloadId;
        } catch (err) {
          this.logger.warn(`No se pudo leer el mensaje ${payloadId} en Unipile: ${String(err)}`);
        }
      }
      if (!text) {
        if (!atts.length && !latestIsSelf) atts = latestAttachments;
        text = await this.describeAttachments(atts, msgId, accountId);
      }
      if (!text) {
        this.logger.warn(`Webhook sin texto ni adjuntos. Claves: ${Object.keys(payload).join(', ')}`);
        void this.errorLog.log({
          level: 'warn',
          source: 'webhook',
          message: `Mensaje entrante descartado: sin texto ni adjuntos reconocibles (chat ${chatId}, msg ${payloadId ?? '?'})`,
          detail: { payload: truncateForLog(payload) },
        });
        return null;
      }
    }

    // Eco de un mensaje NUESTRO: el último de Unipile es nuestro y el texto
    // coincide. Solo así lo tratamos como eco (no basta con que el último sea
    // nuestro, porque la lista puede ir con retraso mientras entra uno real).
    if (latestIsSelf && latestText && text === latestText) {
      return {
        accountId,
        chatId,
        text,
        messageId: payloadId ?? latestId,
        senderName,
        senderProviderId,
        fromSelf: true,
      };
    }

    return {
      accountId,
      chatId,
      text,
      messageId: payloadId ?? latestId,
      senderName,
      senderProviderId,
    };
  }

  /**
   * Convierte los adjuntos de un mensaje sin texto en algo que el bot pueda
   * leer: las notas de voz se transcriben; el resto se describe entre corchetes.
   */
  private async describeAttachments(
    atts: UnipileAttachment[],
    messageId: string | undefined,
    accountId: string,
  ): Promise<string> {
    if (!atts.length) return '';
    const parts: string[] = [];
    for (const a of atts) {
      const type = String(a.type ?? '').toLowerCase();
      const mime = String(a.mimetype ?? '');
      if (type === 'audio' || mime.startsWith('audio/')) {
        let transcript: string | null = null;
        if (messageId && a.id) {
          try {
            const file = await this.unipile.downloadAttachment(messageId, String(a.id));
            const channel = await this.findChannel(accountId);
            transcript = await this.openrouter.transcribeAudio(file.data, file.mime || mime, {
              orgId: (channel?.organization_id as string | undefined) ?? undefined,
            });
          } catch (err) {
            this.logger.warn(`No se pudo transcribir la nota de voz: ${String(err)}`);
          }
        }
        parts.push(transcript ? `[Nota de voz] ${transcript}` : '[Nota de voz que no se ha podido escuchar]');
      } else if (type === 'img' || type === 'image' || mime.startsWith('image/')) {
        parts.push('[Imagen]');
      } else if (type === 'video' || mime.startsWith('video/')) {
        parts.push('[Vídeo]');
      } else if (type === 'sticker' || type === 'gif') {
        parts.push('[Sticker]');
      } else if (type === 'file' || type === 'document' || mime) {
        parts.push(a.file_name ? `[Documento: ${String(a.file_name)}]` : '[Documento]');
      }
    }
    return parts.join('\n');
  }

  /**
   * Eco de un mensaje saliente de nuestra propia cuenta de WhatsApp. Todos los
   * envíos del sistema (burbujas del bot, agente del portal, outbox) se
   * persisten al enviarse, así que si el texto NO coincide con ningún mensaje
   * reciente nuestro, lo escribió un humano desde el móvil / WhatsApp Business
   * → pausamos la IA para que la persona lleve el chat.
   */
  private async handleOwnOutboundEcho(
    orgId: string,
    channel: { id: string; provider: string },
    evt: IncomingEvent,
  ): Promise<void> {
    try {
      const text = evt.text.trim();
      if (!text) return;

      // No creamos chats a partir de ecos, pero sí vinculamos el de un lead que
      // ya teníamos por teléfono (p.ej. la plantilla que GHL envía al entrar).
      const cols = 'id, ai_enabled, source, mode_locked, created_at';
      let conv = await this.findByChat(orgId, channel.id, evt.chatId, cols);
      if (!conv) {
        const { phone } = await this.chatContact(evt.chatId);
        if (phone) {
          // GHL envía la plantilla y avisa del lead casi a la vez: si el eco llega
          // antes que el lead, esperamos a que exista su conversación.
          for (let i = 0; i <= ECHO_LEAD_WAIT_TRIES && !conv; i++) {
            if (i > 0) await sleep(ECHO_GRACE_MS);
            conv =
              (await this.linkIntakeConversation(orgId, channel, evt.chatId, phone, cols)) ??
              (await this.findByChat(orgId, channel.id, evt.chatId, cols));
          }
        }
      }
      if (!conv) return;

      // WhatsApp devuelve el eco con saltos de línea \r\n y espacios distintos a
      // los que guardamos: se compara normalizado, o un mensaje del bot pasaría
      // por manual y pausaría la IA (ocurrió en producción).
      const wanted = normalizeForCompare(text);
      const isOurs = async () => {
        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const { data: recent } = await this.supabase.admin
          .from('messages')
          .select('content')
          .eq('conversation_id', conv!.id)
          .in('role', ['assistant', 'agent'])
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(30);
        return (recent ?? []).some((m) => normalizeForCompare(String(m.content ?? '')) === wanted);
      };
      // Lo que enviamos nosotros se guarda justo después de enviarlo: si el eco
      // llega antes, esperamos un momento antes de tomarlo como mensaje manual.
      if (await isOurs()) return;
      await sleep(ECHO_GRACE_MS);
      if (await isOurs()) return;

      if (evt.messageId && (await this.messageExists(conv.id as string, evt.messageId))) return;

      // La plantilla de primer contacto que GHL envía al registrar el lead no es
      // una persona llevando el chat: si es el PRIMER mensaje NUESTRO de una
      // conversación de lead recién creada, no pausamos (aunque el lead ya haya
      // contestado: su respuesta puede llegarnos antes que el eco de la
      // plantilla). Cualquier otro mensaje manual sí pausa.
      const { count: priorMsgs } = await this.supabase.admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .in('role', ['assistant', 'agent']);
      const createdAt = new Date(String(conv.created_at ?? '')).getTime();
      const firstContact =
        (priorMsgs ?? 0) === 0 &&
        Boolean(conv.mode_locked || conv.source) &&
        Number.isFinite(createdAt) &&
        Date.now() - createdAt < FIRST_CONTACT_WINDOW_MS;

      await this.supabase.admin.from('messages').insert({
        conversation_id: conv.id,
        organization_id: orgId,
        role: 'agent',
        content: text,
        metadata: {
          message_id: evt.messageId ?? null,
          source: firstContact ? 'external_first_contact' : 'manual_echo',
        },
      });

      const update: Record<string, unknown> = {
        last_outbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      };
      if (
        conv.ai_enabled &&
        !firstContact &&
        (await this.setterConfig.getOrCreate(orgId)).pause_on_manual !== false
      ) {
        // Cancela también cualquier respuesta pendiente del bot.
        update.ai_enabled = false;
        update.respond_after = null;
        update.next_followup_at = null;
        this.logger.log(`Mensaje manual detectado en ${conv.id}; IA pausada (human takeover)`);
      }
      await this.supabase.admin.from('conversations').update(update).eq('id', conv.id);
      if (firstContact) {
        await this.startFollowUpsAfterFirstContact(conv.id as string, update.last_outbound_at as string);
      }
    } catch (err) {
      this.logger.warn(`No se pudo procesar el eco saliente: ${String(err)}`);
    }
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

  /**
   * Envía un mensaje manual del agente humano y lo registra. Pausa la IA.
   * Con `automated` (un flujo de GHL) se registra como automático y no pausa.
   */
  async sendAgentMessage(
    orgId: string,
    conversationId: string,
    text: string,
    opts: { automated?: string } = {},
  ) {
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('id, unipile_chat_id, channel_id, transport, contact_handle, provider')
      .eq('id', conversationId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!conv) throw new Error('Conversación no encontrada');

    const update: Record<string, unknown> = {
      last_outbound_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    };

    if (conv.unipile_chat_id) {
      await this.transport.sendText({
        transport: conv.transport as string,
        chatId: conv.unipile_chat_id as string,
        text,
      });
    } else {
      // Aún sin chat (lead de GHL que no ha escrito, o canal reconectado):
      // lo abrimos por teléfono en vez de guardar un mensaje que no se envía.
      const phone = toE164(conv.contact_handle as string | null);
      const channel = await this.liveUnipileChannel(
        orgId,
        conv.channel_id as string | null,
        conv.provider as string | null,
      );
      if (!phone || !channel) {
        throw new BadRequestException(
          'Este contacto aún no tiene chat abierto y no hay un teléfono o canal conectado para escribirle.',
        );
      }
      const { chatId } = await this.transport.startChat({
        transport: conv.transport as string,
        accountId: channel.unipile_account_id as string,
        recipientId: whatsappDigits(phone),
        text,
      });
      update.channel_id = channel.id;
      if (chatId) {
        update.unipile_chat_id = chatId;
        update.contact_external_id = chatId;
      }
    }

    await this.supabase.admin.from('messages').insert({
      conversation_id: conversationId,
      organization_id: orgId,
      role: opts.automated ? 'assistant' : 'agent',
      content: text,
      ...(opts.automated ? { metadata: { source: opts.automated } } : {}),
    });
    // Al escribir manualmente, la IA se pausa (si la cuenta lo tiene activado).
    if (
      !opts.automated &&
      (await this.setterConfig.getOrCreate(orgId)).pause_on_manual !== false
    ) {
      update.ai_enabled = false;
      update.respond_after = null;
      update.next_followup_at = null;
    }
    await this.supabase.admin.from('conversations').update(update).eq('id', conversationId);

    return { ok: true };
  }

  /**
   * Envía un texto del bot. Si la conversación aún no tiene chat en Unipile
   * (canal recién reconectado: los ids de chat cambian con la cuenta nueva) lo
   * abre por teléfono con ese mismo texto. Devuelve el chat a usar después.
   * Si Unipile dice que la cuenta está desconectada, marca el canal para que se
   * vea en el panel.
   */
  private async deliverBotText(
    orgId: string,
    conversationId: string,
    conv: Record<string, unknown>,
    chatId: string | null,
    text: string,
  ): Promise<string | null> {
    try {
      if (chatId || conv.transport !== 'unipile') {
        await this.transport.sendText({
          transport: conv.transport as string,
          chatId,
          text,
          channelId: conv.channel_id as string | null,
          to: (conv.contact_handle ?? conv.contact_external_id) as string | null,
        });
        return chatId;
      }

      const phone = toE164(conv.contact_handle as string | null);
      const channel = await this.liveUnipileChannel(
        orgId,
        conv.channel_id as string | null,
        conv.provider as string | null,
      );
      if (!phone || !channel) {
        throw new Error('La conversación no tiene chat abierto ni un teléfono/canal conectado para escribirle');
      }
      const started = await this.transport.startChat({
        transport: 'unipile',
        accountId: channel.unipile_account_id as string,
        recipientId: whatsappDigits(phone),
        text,
      });
      if (started.chatId) {
        await this.supabase.admin
          .from('conversations')
          .update({
            channel_id: channel.id,
            unipile_chat_id: started.chatId,
            contact_external_id: started.chatId,
          })
          .eq('id', conversationId);
      }
      return started.chatId;
    } catch (err) {
      if (String(err).includes('disconnected_account')) {
        void this.markChannelDisconnected(conv.channel_id as string | null);
      }
      throw err;
    }
  }

  /**
   * Canal de Unipile por el que escribir: el de la conversación si sigue
   * conectado; si no (canal caído o sustituido al reconectar), el más reciente
   * conectado de la org para ese proveedor.
   */
  private async liveUnipileChannel(
    orgId: string,
    preferredId: string | null,
    provider: string | null,
  ): Promise<{ id: string; unipile_account_id: string } | null> {
    const base = () =>
      this.supabase.admin
        .from('channels')
        .select('id, unipile_account_id')
        .eq('organization_id', orgId)
        .eq('status', 'connected')
        .not('unipile_account_id', 'is', null);
    if (preferredId) {
      const { data } = await base().eq('id', preferredId).maybeSingle();
      if (data) return data as { id: string; unipile_account_id: string };
    }
    const { data } = await base()
      .eq('provider', provider ?? 'whatsapp')
      .order('connected_at', { ascending: false })
      .limit(1);
    return (data?.[0] as { id: string; unipile_account_id: string } | undefined) ?? null;
  }

  private async markChannelDisconnected(channelId: string | null) {
    if (!channelId) return;
    await this.supabase.admin
      .from('channels')
      .update({
        status: 'error',
        last_error: 'WhatsApp se ha desconectado: hay que volver a conectar el número.',
      })
      .eq('id', channelId)
      .eq('status', 'connected');
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

    // Lock en BD por conversación: garantiza que SOLO un tick responde a la vez a
    // este chat (evita duplicados si dos ticks del cron se solapan). Al mismo
    // tiempo limpiamos `respond_after`: si llega un mensaje nuevo mientras
    // respondemos, su scheduleResponse volverá a ponerlo y el próximo tick lo
    // recogerá. El UPDATE condicional es atómico: solo un tick "gana" el lock.
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - LOCK_STALE_MS).toISOString();
    const { data: locked } = await this.supabase.admin
      .from('conversations')
      .update({ responding_lock_at: nowIso, respond_after: null })
      .eq('id', conversationId)
      .or(`responding_lock_at.is.null,responding_lock_at.lt.${staleIso}`)
      .select('id')
      .maybeSingle();
    if (!locked) {
      this.logger.log(`Respuesta en curso para ${conversationId}; se omite duplicado`);
      return;
    }

    try {
      await this.generateAndSendLocked(job, orgId, conversationId, chatId, provider);
    } catch (err) {
      await this.retryResponseLater(orgId, conversationId, err);
      throw err;
    } finally {
      try {
        await this.supabase.admin
          .from('conversations')
          .update({ responding_lock_at: null })
          .eq('id', conversationId);
      } catch {
        // el lock caduca solo (LOCK_STALE_MS) si no se pudo liberar
      }
    }
  }

  /**
   * El lock ya limpió respond_after: si la generación falla (p.ej. el modelo sin
   * saldo) hay que reprogramarla o el lead se queda sin respuesta para siempre.
   * Solo se reintenta durante un día desde su último mensaje.
   */
  private async retryResponseLater(orgId: string, conversationId: string, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    void this.errorLog.log({
      source: 'respond',
      message: `No se pudo responder (conv ${conversationId}): ${message}`,
      organizationId: orgId,
    });
    try {
      await this.supabase.admin
        .from('conversations')
        .update({ respond_after: new Date(Date.now() + RESPOND_RETRY_MS).toISOString() })
        .eq('id', conversationId)
        .is('respond_after', null)
        .gte('last_inbound_at', new Date(Date.now() - RESPOND_RETRY_WINDOW_MS).toISOString());
    } catch {
      // sin reprogramar: el siguiente mensaje del lead lo vuelve a poner en cola
    }
  }

  private async generateAndSendLocked(
    job: RespondJob,
    orgId: string,
    conversationId: string,
    chatId: string,
    provider: string,
  ) {
    void job;
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select(
        'id, ai_enabled, blocked, mode, mode_locked, contact_name, contact_external_id, contact_handle, last_inbound_at, transport, provider, channel_id, agent_id, stage',
      )
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv || !conv.ai_enabled || conv.blocked) return;

    const cfg = await this.setterConfig.getOrCreate(orgId);
    if (!cfg.is_active) return;

    // Control de coste: si la org superó su tope de tokens del día, no responde.
    if (cfg.daily_token_limit && cfg.daily_token_limit > 0) {
      const used = await this.openrouter.tokensUsedToday(orgId);
      if (used >= cfg.daily_token_limit) {
        this.logger.warn(
          `Límite diario de tokens alcanzado (org ${orgId}: ${used}/${cfg.daily_token_limit}); no se responde`,
        );
        return;
      }
    }

    // Qué agente atiende: override de la conversación → modo soporte confirmado
    // → agente del canal → predeterminado para conversaciones nuevas.
    const agent = await this.agents.resolveForConversation(orgId, {
      agent_id: conv.agent_id as string | null,
      channel_id: conv.channel_id as string | null,
      mode: conv.mode as string | null,
    });
    if (!agent) {
      this.logger.warn(`Org ${orgId} sin agentes activos; no se responde (${conversationId})`);
      return;
    }
    // Horario y tiempos: los del agente si tiene ajustes propios.
    const behavior = effectiveBehavior(cfg, agent);

    const silenceCandidates = [conv.contact_external_id, conv.contact_handle].filter(
      Boolean,
    ) as string[];
    if (await this.silenced.isAnySilenced(orgId, silenceCandidates, agent.id)) {
      this.logger.log(`Contacto silenciado (${silenceCandidates.join(', ')}); no se responde`);
      return;
    }

    if (
      behavior.active_hours_enabled &&
      !inActiveHours(behavior.active_hours_start, behavior.active_hours_end, behavior.timezone)
    ) {
      // El lock ya limpió respond_after; si no lo reprogramamos, este lead se
      // quedaría sin respuesta para siempre. Lo diferimos a la próxima franja
      // activa para que el bot RETOME la conversación al abrirse el horario.
      const resumeAt = nextActiveSlot(
        Date.now(),
        true,
        behavior.active_hours_start,
        behavior.active_hours_end,
        behavior.timezone,
      );
      await this.supabase.admin
        .from('conversations')
        .update({ respond_after: new Date(resumeAt).toISOString() })
        .eq('id', conversationId);
      this.logger.log(
        `Fuera de horario; respuesta diferida a ${new Date(resumeAt).toISOString()} (${conversationId})`,
      );
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

    // Clasificación (una vez) por si aún no tiene modo. La IA solo APLICA
    // 'setter'; si propone 'support' o 'ignored' lo guarda como sugerencia
    // (suggested_mode) y el chat sigue en modo setter hasta que un humano la
    // confirme desde el inbox. Así un lead real nunca se degrada solo.
    let mode = conv.mode as string;
    if (mode === 'unclassified' && !conv.mode_locked) {
      const proposed = await this.classifier.classify(orgId, chatId, provider);
      mode = 'setter';
      await this.supabase.admin
        .from('conversations')
        .update(
          proposed === 'setter'
            ? { mode: 'setter' }
            : { mode: 'setter', suggested_mode: proposed },
        )
        .eq('id', conversationId);
      this.logger.log(
        `Conversación ${conversationId} clasificada como: ${proposed}` +
          (proposed !== 'setter' ? ' (solo sugerencia; sigue en setter)' : ''),
      );
    }
    if (mode === 'ignored') return;

    // Marca de agua: el momento del último mensaje entrante AHORA. Si durante el
    // envío entra uno más nuevo, abortamos.
    const watermark = conv.last_inbound_at ?? null;

    const bubbles = await this.setter.respond(orgId, conversationId, {
      agent,
      contactName: conv.contact_name,
      persist: false,
    });
    if (bubbles.length === 0) return;

    // Enlace de agenda del agente (modo enlace): si lo manda, la conversación
    // pasa a "Calendario enviado". "Llamada agendada" solo la pone la cita
    // confirmada (webhook de GHL / calendario interno).
    const calendarLink =
      agent.kind !== 'support' && agent.calendar_mode === 'link' && agent.calendar_link
        ? normalizeLink(agent.calendar_link)
        : null;

    // Las etapas de agenda (calendario enviado, llamada agendada) son del
    // pipeline principal: solo se mueven si el agente trabaja en él.
    const mainPipelineId = (await this.stages.defaultPipeline(orgId))?.id ?? null;
    const onMainPipeline = Boolean(agent.pipeline_id) && agent.pipeline_id === mainPipelineId;

    // Retardo inicial (simula "leer"). El cps/longitud da el ritmo entre burbujas.
    await sleep(randomSeconds(behavior.first_reply_min_s, behavior.first_reply_max_s) * 1000);

    let target: string | null = chatId || null;
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
        target = await this.deliverBotText(orgId, conversationId, conv, target, b.content);
      } catch (err) {
        // Se relanza para que generateAndSend reprograme la respuesta: si no,
        // el lead se queda sin contestar para siempre.
        this.logger.error(`No se pudo enviar la burbuja: ${String(err)}`);
        throw err;
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

      if (calendarLink && onMainPipeline && normalizeLink(b.content).includes(calendarLink)) {
        void this.stages.setConversationStage(orgId, conversationId, 'calendar_sent', {
          skipIfIn: ['calendar_sent', 'call_scheduled', 'won', 'lost', 'not_qualified'],
        });
      }
    }

    // Si el lead no contesta, el agente le hará seguimiento según su secuencia.
    await this.scheduleFollowUp(conversationId, agent, conv.stage as string | null);

    // El bot ha hablado con este contacto → lo registramos como lead en el CRM
    // (si aún no lo estaba). Así todos los chats atendidos quedan en el CRM.
    void this.ensureLeadForConversation(orgId, conversationId);
    // Tras responder, el bot comprueba si el lead ha agendado/confirmado una
    // llamada. Solo agentes con pipeline; y NO en modo enlace, donde el flujo es
    // "Calendario enviado" → la confirmación llega por el webhook de la cita.
    if (onMainPipeline && agent.calendar_mode !== 'link') {
      void this.appointmentDetector.maybeDetect(orgId, conversationId);
    }
    // Auto-etiquetado IA: analiza la conversación y aplica las etiquetas que
    // correspondan según sus criterios (respeta lo manual).
    void this.tagClassifier.maybeTag(orgId, conversationId);
  }

  // ---------------------------------------------------------------------------
  //  SEGUIMIENTO AUTOMÁTICO
  // ---------------------------------------------------------------------------

  /**
   * Tras una respuesta del bot: si el agente tiene seguimiento activado y el
   * lead no está en una etapa final, programa el primer seguimiento.
   */
  private async scheduleFollowUp(conversationId: string, agent: Agent, stage: string | null) {
    const delays = agent.followup_delays_min ?? [];
    if (!agent.followup_enabled || delays.length === 0) return;
    if (stage && FOLLOWUP_STOP_STAGES.has(stage)) return;
    await this.supabase.admin
      .from('conversations')
      .update({
        followup_count: 0,
        next_followup_at: new Date(Date.now() + delays[0] * 60_000).toISOString(),
      })
      .eq('id', conversationId);
  }

  /**
   * Primer contacto que no envió el bot (la plantilla de GHL): arranca la
   * secuencia de seguimiento del agente contando desde ese mensaje, como si lo
   * hubiera enviado él. Solo en leads recientes que aún no han escrito y cuya
   * secuencia no ha empezado.
   */
  async startFollowUpsAfterFirstContact(conversationId: string, sentAt: string): Promise<void> {
    try {
      const sentMs = Date.parse(sentAt);
      if (!Number.isFinite(sentMs) || Date.now() - sentMs > FIRST_CONTACT_FOLLOWUP_WINDOW_MS) return;
      const { data: conv } = await this.supabase.admin
        .from('conversations')
        .select(
          'id, organization_id, agent_id, channel_id, mode, stage, source, ai_enabled, followups_paused, next_followup_at, followup_count, last_inbound_at, last_outbound_at',
        )
        .eq('id', conversationId)
        .maybeSingle();
      if (
        !conv ||
        !conv.source ||
        !conv.ai_enabled ||
        conv.followups_paused ||
        conv.next_followup_at ||
        conv.followup_count ||
        conv.last_inbound_at ||
        (conv.stage && FOLLOWUP_STOP_STAGES.has(conv.stage as string))
      ) {
        return;
      }
      const { count: fromLead } = await this.supabase.admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('role', 'contact');
      if (fromLead) return;

      const agent = await this.agents.resolveForConversation(conv.organization_id as string, {
        agent_id: conv.agent_id as string | null,
        channel_id: conv.channel_id as string | null,
        mode: conv.mode as string | null,
      });
      const delays = agent?.followup_delays_min ?? [];
      if (!agent?.followup_enabled || delays.length === 0) return;

      const dueAt = new Date(Math.max(Date.now(), sentMs + delays[0] * 60_000)).toISOString();
      const lastOut = conv.last_outbound_at as string | null;
      await this.supabase.admin
        .from('conversations')
        .update({
          followup_count: 0,
          next_followup_at: dueAt,
          last_outbound_at: lastOut && lastOut > sentAt ? lastOut : sentAt,
        })
        .eq('id', conversationId)
        .is('next_followup_at', null);
      this.logger.log(`Seguimiento programado tras el primer contacto (conv ${conversationId}, ${dueAt})`);
    } catch (err) {
      this.logger.warn(`No se pudo programar el seguimiento tras el primer contacto: ${String(err)}`);
    }
  }

  /** Envía los seguimientos vencidos (lo llama el cron). Devuelve cuántos mandó. */
  async processDueFollowUps(limit = FOLLOWUP_BATCH): Promise<number> {
    const nowIso = new Date().toISOString();
    const { data: due } = await this.supabase.admin
      .from('conversations')
      .select('id, organization_id')
      .lte('next_followup_at', nowIso)
      .not('next_followup_at', 'is', null)
      .eq('ai_enabled', true)
      .eq('blocked', false)
      .is('archived_at', null)
      .order('next_followup_at', { ascending: true })
      .limit(limit);
    if (!due || due.length === 0) return 0;

    const results = await Promise.allSettled(
      due.map((c) => this.sendFollowUp(c.organization_id as string, c.id as string)),
    );
    let sent = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') sent += r.value ? 1 : 0;
      else {
        const reason = r.reason instanceof Error ? r.reason.stack ?? r.reason.message : String(r.reason);
        this.logger.error(`Error en seguimiento de conv ${due[i].id}: ${reason}`);
        void this.errorLog.log({
          source: 'followup',
          message: `No se pudo enviar el seguimiento (conv ${due[i].id}): ${reason.slice(0, 1500)}`,
          organizationId: due[i].organization_id as string,
        });
      }
    });
    return sent;
  }

  private async sendFollowUp(orgId: string, conversationId: string): Promise<boolean> {
    // Mismo lock que las respuestas: nunca dos envíos a la vez al mismo chat.
    // Se vacía next_followup_at al tomarlo; se vuelve a poner al terminar.
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - LOCK_STALE_MS).toISOString();
    const { data: locked } = await this.supabase.admin
      .from('conversations')
      .update({ responding_lock_at: nowIso, next_followup_at: null })
      .eq('id', conversationId)
      .not('next_followup_at', 'is', null)
      .or(`responding_lock_at.is.null,responding_lock_at.lt.${staleIso}`)
      .select('id')
      .maybeSingle();
    if (!locked) return false;

    try {
      return await this.sendFollowUpLocked(orgId, conversationId);
    } catch (err) {
      // Reintento único en media hora (p.ej. el modelo falló).
      await this.supabase.admin
        .from('conversations')
        .update({ next_followup_at: new Date(Date.now() + 30 * 60_000).toISOString() })
        .eq('id', conversationId)
        .is('next_followup_at', null);
      throw err;
    } finally {
      await this.supabase.admin
        .from('conversations')
        .update({ responding_lock_at: null })
        .eq('id', conversationId);
    }
  }

  private async sendFollowUpLocked(orgId: string, conversationId: string): Promise<boolean> {
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select(
        'id, ai_enabled, blocked, archived_at, is_test, stage, mode, contact_name, contact_handle, contact_external_id, unipile_chat_id, transport, provider, channel_id, agent_id, last_inbound_at, last_outbound_at, followup_count, followups_paused, window_expires_at',
      )
      .eq('id', conversationId)
      .maybeSingle();
    // El lock ya vació next_followup_at. Las condiciones DEFINITIVAS (el lead
    // contestó, etapa final, IA apagada…) cierran la cadena; las TRANSITORIAS
    // (workflow en marcha, IA de la org pausada, tope de tokens) la aplazan
    // para que el seguimiento no se pierda en silencio.
    const stop = (reason: string) => {
      this.logger.log(`Seguimiento cancelado (conv ${conversationId}): ${reason}`);
      return false;
    };
    const defer = async (reason: string, minutes: number) => {
      await this.supabase.admin
        .from('conversations')
        .update({ next_followup_at: new Date(Date.now() + minutes * 60_000).toISOString() })
        .eq('id', conversationId);
      this.logger.log(`Seguimiento aplazado ${minutes} min (conv ${conversationId}): ${reason}`);
      return false;
    };

    if (!conv || !conv.ai_enabled || conv.blocked || conv.archived_at || conv.is_test) {
      return stop('conversación sin IA, bloqueada, archivada o de prueba');
    }
    if (conv.followups_paused || conv.mode === 'ignored') return stop('seguimientos pausados o chat ignorado');
    if (conv.stage && FOLLOWUP_STOP_STAGES.has(conv.stage as string)) return stop(`etapa final ${String(conv.stage)}`);
    if (!conv.last_outbound_at) return stop('sin mensajes nuestros');

    const cfg = await this.setterConfig.getOrCreate(orgId);
    if (!cfg.is_active) return defer('IA de la organización desactivada', 60);
    if (cfg.daily_token_limit && cfg.daily_token_limit > 0) {
      const used = await this.openrouter.tokensUsedToday(orgId);
      if (used >= cfg.daily_token_limit) return defer('tope diario de tokens alcanzado', 60);
    }

    const agent = await this.agents.resolveForConversation(orgId, {
      agent_id: conv.agent_id as string | null,
      channel_id: conv.channel_id as string | null,
      mode: conv.mode as string | null,
    });
    const delays = agent?.followup_delays_min ?? [];
    const step = (conv.followup_count as number) ?? 0;
    if (!agent || !agent.followup_enabled) return stop('agente sin seguimiento activado');
    if (step >= delays.length) return stop('secuencia completada');

    // Solo si el lead sigue sin contestar: el último mensaje debe ser nuestro.
    const { data: last } = await this.supabase.admin
      .from('messages')
      .select('role')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last || last.role === 'contact') return stop('el lead ya contestó');

    // Si un workflow está persiguiendo AHORA a este lead (run activo), no
    // duplicamos: lo volvemos a mirar en un rato. Los runs pausados no cuentan:
    // quedan así cuando el lead contesta y, salvo reanudación programada, no
    // vuelven a escribirle.
    const { count: runs } = await this.supabase.admin
      .from('workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('status', 'active');
    if (runs) return defer('workflow activo en este chat', 30);

    // Cloud API: fuera de la ventana de 24 h solo se puede mandar plantilla.
    if (
      conv.transport === 'whatsapp_cloud' &&
      conv.window_expires_at &&
      new Date(conv.window_expires_at as string).getTime() < Date.now()
    ) {
      return stop('ventana de 24 h de WhatsApp Cloud cerrada');
    }

    const behavior = effectiveBehavior(cfg, agent);
    if (
      behavior.active_hours_enabled &&
      !inActiveHours(behavior.active_hours_start, behavior.active_hours_end, behavior.timezone)
    ) {
      const resumeAt = nextActiveSlot(
        Date.now(),
        true,
        behavior.active_hours_start,
        behavior.active_hours_end,
        behavior.timezone,
      );
      await this.supabase.admin
        .from('conversations')
        .update({ next_followup_at: new Date(resumeAt).toISOString() })
        .eq('id', conversationId);
      return false;
    }

    // Sin chat (canal reconectado) se abre por teléfono al enviar.
    let chatId = (conv.unipile_chat_id ?? conv.contact_external_id) as string | null;
    if (!chatId && !conv.contact_handle) return stop('conversación sin chat ni teléfono al que escribir');

    // Lo que de verdad lleva el lead callado: desde SU último mensaje (no desde
    // el último empujón nuestro, que resetearía el contador en cada seguimiento).
    const silentSince = (conv.last_inbound_at ?? conv.last_outbound_at) as string;
    const silentMinutes = Math.max(
      1,
      Math.round((Date.now() - new Date(silentSince).getTime()) / 60_000),
    );
    // Lo que ya le hemos dicho sin respuesta en esta racha (la plantilla de
    // primer contacto incluida), para que el modelo no lo repita.
    let previousQ = this.supabase.admin
      .from('messages')
      .select('content')
      .eq('conversation_id', conversationId)
      .in('role', ['assistant', 'agent'])
      .order('created_at', { ascending: true })
      .limit(10);
    if (conv.last_inbound_at) previousQ = previousQ.gt('created_at', conv.last_inbound_at as string);
    const { data: previousRows } = await previousQ;
    const previous = (previousRows ?? []).map((r) => r.content as string);

    const bubbles = await this.setter.followUp(orgId, conversationId, {
      agent,
      contactName: conv.contact_name as string | null,
      persist: false,
      step,
      total: delays.length,
      silentMinutes,
      previous,
    });

    const nextStep = step + 1;
    if (bubbles.length === 0) {
      // El modelo decidió no insistir: cerramos el ciclo para este chat.
      await this.supabase.admin
        .from('conversations')
        .update({ followup_count: delays.length, next_followup_at: null })
        .eq('id', conversationId);
      this.logger.log(`Seguimiento omitido por el modelo (conv ${conversationId})`);
      return false;
    }

    const watermark = conv.last_inbound_at as string | null;
    for (const b of bubbles) {
      if (await this.newerInboundExists(conversationId, watermark)) return stop('el lead escribió mientras tanto');
      await sleep(Math.min(b.delayMs, 8_000));
      chatId = await this.deliverBotText(orgId, conversationId, conv, chatId, b.content);
      await this.supabase.admin.from('messages').insert({
        conversation_id: conversationId,
        organization_id: orgId,
        role: 'assistant',
        content: b.content,
        metadata: { followup: nextStep },
      });
    }

    const nextAt =
      nextStep < delays.length ? new Date(Date.now() + delays[nextStep] * 60_000).toISOString() : null;
    await this.supabase.admin
      .from('conversations')
      .update({
        last_outbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        followup_count: nextStep,
        next_followup_at: nextAt,
      })
      .eq('id', conversationId);
    this.logger.log(`Seguimiento ${nextStep}/${delays.length} enviado (conv ${conversationId})`);
    return true;
  }

  /**
   * Registra el chat como lead en el CRM cuando el bot le ha hablado y todavía
   * no existe un lead para esa conversación. Si ya hay un lead con el mismo
   * teléfono pero sin conversación, lo enlaza en vez de duplicar.
   */
  private async ensureLeadForConversation(orgId: string, conversationId: string) {
    try {
      const { data: byConv } = await this.supabase.admin
        .from('leads')
        .select('id')
        .eq('organization_id', orgId)
        .eq('conversation_id', conversationId)
        .limit(1);
      if (byConv?.length) return;

      const { data: conv } = await this.supabase.admin
        .from('conversations')
        .select(
          'contact_name, contact_handle, provider, source, source_detail, campaign, external_subscriber_id',
        )
        .eq('id', conversationId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!conv) return;

      const phone = toE164(conv.contact_handle as string | null);
      if (phone) {
        const { data: byPhone } = await this.supabase.admin
          .from('leads')
          .select('id')
          .eq('organization_id', orgId)
          .in('phone', phoneVariants(phone))
          .is('conversation_id', null)
          .order('created_at', { ascending: true })
          .limit(1);
        if (byPhone?.length) {
          await this.supabase.admin
            .from('leads')
            .update({ conversation_id: conversationId })
            .eq('id', byPhone[0].id);
          return;
        }
      }

      const { error: insertError } = await this.supabase.admin.from('leads').insert({
        organization_id: orgId,
        conversation_id: conversationId,
        name: (conv.contact_name as string | null) ?? null,
        phone,
        provider: (conv.provider as string | null) ?? null,
        source: (conv.source as string | null) ?? 'inbound',
        source_detail: (conv.source_detail as string | null) ?? null,
        campaign: (conv.campaign as string | null) ?? null,
        external_id: (conv.external_subscriber_id as string | null) ?? null,
        status: 'new',
        consent_optin: true,
      });
      // 23505: otra ejecución en paralelo ya creó el lead de esta conversación.
      if (insertError) {
        if (insertError.code !== '23505') throw insertError;
        return;
      }
      // Lead nuevo por chat → contacto en GHL (si la cuenta lo tiene configurado).
      void this.ghlSync.syncChatLead(orgId, conversationId);
    } catch (err) {
      this.logger.warn(
        `No se pudo registrar el lead del chat ${conversationId}: ${String(err)}`,
      );
    }
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
    if (job.kind === 'workflow') {
      await this.deliverWorkflow(job);
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
    const now = Date.now();

    // El "próximo hueco" se calcula a partir del último proactivo PENDIENTE de la
    // org en el outbox: así los envíos quedan espaciados en el tiempo (jitter) y
    // no salen todos de golpe (protege el número de WhatsApp).
    const { data: lastPending } = await this.supabase.admin
      .from('outbox')
      .select('send_after')
      .eq('organization_id', params.orgId)
      .eq('kind', 'proactive')
      .is('sent_at', null)
      .order('send_after', { ascending: false })
      .limit(1)
      .maybeSingle();

    let slot = lastPending?.send_after
      ? new Date(lastPending.send_after as string).getTime() + spacingMs
      : now;
    if (slot < now) slot = now;
    slot = nextActiveSlot(
      slot,
      cfg.active_hours_enabled,
      cfg.active_hours_start,
      cfg.active_hours_end,
      cfg.timezone,
    );

    await this.supabase.admin.from('outbox').insert({
      organization_id: params.orgId,
      conversation_id: params.conversationId,
      kind: 'proactive',
      transport: params.transport ?? null,
      account_id: params.accountId,
      attendee_id: params.attendeeId,
      content: params.content,
      send_after: new Date(slot).toISOString(),
    });

    return { delayMs: Math.max(0, slot - now) };
  }

  private async deliverProactive(job: OutgoingJob) {
    // Evita duplicar si ya se contactó (reintentos / carreras).
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('proactive_sent, channel_id, provider')
      .eq('id', job.conversationId)
      .maybeSingle();
    if (conv?.proactive_sent) return;

    // Lanzar (no volver en silencio): si no, la cola lo marca como enviado.
    const channel = await this.liveUnipileChannel(
      job.orgId,
      (conv?.channel_id as string | null) ?? null,
      (conv?.provider as string | null) ?? null,
    );
    const accountId = channel?.unipile_account_id ?? job.accountId;
    if (!accountId) throw new Error('Sin canal de WhatsApp conectado para el primer mensaje');
    if (!job.attendeeId) throw new Error('El lead no tiene teléfono para el primer mensaje');

    const { chatId } = await this.transport.startChat({
      transport: job.transport,
      accountId,
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
        ...(channel ? { channel_id: channel.id } : {}),
        last_outbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      })
      .eq('id', job.conversationId);
    this.logger.log(`Primer mensaje proactivo enviado (conv ${job.conversationId})`);
  }

  /**
   * Encola un mensaje de WORKFLOW (primer contacto o seguimiento). Determina el
   * destino desde la conversación (chat existente → sendText; sin chat → primer
   * contacto vía startChat) y respeta el espaciado + horario activo del outbox.
   */
  async enqueueWorkflowSend(params: {
    orgId: string;
    conversationId: string;
    content: string;
  }): Promise<{ skipped?: string; delayMs?: number }> {
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('unipile_chat_id, contact_external_id, contact_handle, channel_id, transport, provider')
      .eq('id', params.conversationId)
      .maybeSingle();
    if (!conv) return { skipped: 'sin conversación' };

    const chatId = (conv.unipile_chat_id ?? conv.contact_external_id) as string | null;
    const transport = (conv.transport as string | null) ?? undefined;

    const insert: Record<string, unknown> = {
      organization_id: params.orgId,
      conversation_id: params.conversationId,
      kind: 'workflow',
      transport: transport ?? null,
      content: params.content,
    };

    if (chatId) {
      insert.chat_id = chatId;
    } else {
      // Primer contacto: necesitamos cuenta de Unipile + teléfono del lead.
      const channel = await this.liveUnipileChannel(
        params.orgId,
        conv.channel_id as string | null,
        conv.provider as string | null,
      );
      const attendee = ((conv.contact_handle as string) ?? '').replace(/[^\d]/g, '');
      if (!channel || !attendee) return { skipped: 'sin destino' };
      insert.account_id = channel.unipile_account_id;
      insert.attendee_id = attendee;
    }

    const slot = await this.nextOutboxSlot(params.orgId);
    insert.send_after = new Date(slot).toISOString();

    await this.supabase.admin.from('outbox').insert(insert);
    return { delayMs: Math.max(0, slot - Date.now()) };
  }

  /** Entrega un mensaje de workflow: a chat existente o como primer contacto. */
  private async deliverWorkflow(job: OutgoingJob) {
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('unipile_chat_id, contact_external_id, proactive_sent')
      .eq('id', job.conversationId)
      .maybeSingle();
    if (!conv) return;

    let chatId = (job.chatId ?? conv.unipile_chat_id ?? conv.contact_external_id) as string | null;

    if (chatId) {
      await this.transport.sendText({ transport: job.transport, chatId, text: job.content });
    } else if (job.accountId && job.attendeeId) {
      const started = await this.transport.startChat({
        transport: job.transport,
        accountId: job.accountId,
        recipientId: job.attendeeId,
        text: job.content,
      });
      chatId = started.chatId;
      await this.supabase.admin
        .from('conversations')
        .update({
          proactive_sent: true,
          unipile_chat_id: chatId,
          contact_external_id: chatId,
        })
        .eq('id', job.conversationId);
    } else {
      throw new Error('Mensaje de workflow sin chat ni cuenta/teléfono de destino');
    }

    await this.supabase.admin.from('messages').insert({
      conversation_id: job.conversationId,
      organization_id: job.orgId,
      role: 'assistant',
      content: job.content,
      metadata: { workflow: true },
    });
    await this.supabase.admin
      .from('conversations')
      .update({
        last_outbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      })
      .eq('id', job.conversationId);
  }

  /**
   * Próximo hueco para el outbox: espaciado (jitter) tras el último pendiente de
   * la org + horario activo. Compartido por proactivos y workflows.
   */
  private async nextOutboxSlot(orgId: string): Promise<number> {
    const cfg = await this.setterConfig.getOrCreate(orgId);
    const spacingMs = randomSeconds(40, 100) * 1000;
    const now = Date.now();
    const { data: lastPending } = await this.supabase.admin
      .from('outbox')
      .select('send_after')
      .eq('organization_id', orgId)
      .is('sent_at', null)
      .order('send_after', { ascending: false })
      .limit(1)
      .maybeSingle();
    let slot = lastPending?.send_after
      ? new Date(lastPending.send_after as string).getTime() + spacingMs
      : now;
    if (slot < now) slot = now;
    return nextActiveSlot(
      slot,
      cfg.active_hours_enabled,
      cfg.active_hours_start,
      cfg.active_hours_end,
      cfg.timezone,
    );
  }

  /**
   * El lead respondió: los runs que estaban en un nodo "Esperar respuesta" se
   * DESPIERTAN ya (para salir por la rama "respondió"); el resto de workflows
   * activos se pausan (los seguimientos no persiguen a quien ya contesta).
   */
  private async pauseWorkflowRuns(conversationId: string) {
    const now = new Date().toISOString();
    try {
      await this.supabase.admin
        .from('workflow_runs')
        .update({ next_run_at: now, locked_at: null, updated_at: now })
        .eq('conversation_id', conversationId)
        .eq('status', 'active')
        .eq('context->>waiting_reply', 'true');
      await this.supabase.admin
        .from('workflow_runs')
        .update({ status: 'paused', locked_at: null, updated_at: now })
        .eq('conversation_id', conversationId)
        .eq('status', 'active')
        .or('context->>waiting_reply.is.null,context->>waiting_reply.neq.true');
    } catch (err) {
      this.logger.warn(`No se pudieron pausar los workflows de ${conversationId}: ${String(err)}`);
    }
  }

  private async findChannel(accountId: string) {
    const { data } = await this.supabase.admin
      .from('channels')
      .select('id, organization_id, provider')
      .eq('unipile_account_id', accountId)
      .maybeSingle();
    return data;
  }

  /** Conversación ya asociada a este chat del proveedor (si existe). */
  async findByChat(orgId: string, channelId: string, chatId: string, cols = CONV_COLS) {
    const { data } = await this.supabase.admin
      .from('conversations')
      .select(cols)
      .eq('organization_id', orgId)
      .eq('channel_id', channelId)
      .eq('contact_external_id', chatId)
      .eq('is_test', false)
      .order('created_at', { ascending: true })
      .limit(1);
    const found = (data?.[0] as unknown as Record<string, any> | undefined) ?? null;
    if (found) return found;

    // Los ids de chat de Unipile son únicos: si el chat ya está en otra
    // conversación de la org (colgada de un canal antiguo o caído), es la misma.
    // La pasamos a este canal en vez de crear un duplicado.
    const { data: elsewhere } = await this.supabase.admin
      .from('conversations')
      .select('id')
      .eq('organization_id', orgId)
      .eq('contact_external_id', chatId)
      .eq('is_test', false)
      .order('created_at', { ascending: true })
      .limit(1);
    const otherId = elsewhere?.[0]?.id as string | undefined;
    if (!otherId) return null;
    const { data: moved } = await this.supabase.admin
      .from('conversations')
      .update({ channel_id: channelId })
      .eq('id', otherId)
      .select(cols)
      .maybeSingle();
    if (moved) this.logger.log(`Chat ${chatId}: conversación ${otherId} pasada al canal ${channelId}`);
    return (moved as unknown as Record<string, any> | null) ?? null;
  }

  /** Nombre y teléfono real del contacto de un chat (vía participantes). */
  async chatContact(chatId: string): Promise<{ name: string | null; phone: string | null }> {
    try {
      const attendees = await this.unipile.listChatAttendees(chatId);
      const other = attendees.find((a) => !(a.is_self === 1 || a.is_self === true));
      if (other) return { name: other.name?.trim() || null, phone: phoneOfAttendee(other) };
    } catch (err) {
      this.logger.warn(`No se pudieron leer los participantes del chat ${chatId}: ${String(err)}`);
    }
    return { name: null, phone: null };
  }

  /**
   * Un lead que entró por GHL/formulario tiene ya su conversación (con el
   * setter_id, el agente y la IA según GHL) pero sin chat de WhatsApp. Cuando
   * aparece el chat de ese teléfono la vinculamos a ella en vez de crear otra:
   * si no, la activación desde GHL caería en una conversación vacía y las
   * respuestas del contacto en otra con la IA en pausa.
   */
  async linkIntakeConversation(
    orgId: string,
    channel: { id: string; provider: string },
    chatId: string,
    phone: string,
    cols = CONV_COLS,
  ) {
    const { data } = await this.supabase.admin
      .from('conversations')
      .select(`${cols}, channel_id`)
      .eq('organization_id', orgId)
      .eq('provider', channel.provider)
      .in('contact_handle', phoneVariants(phone))
      .is('unipile_chat_id', null)
      .is('contact_external_id', null)
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .limit(5);
    const candidates = (data ?? []) as unknown as Record<string, any>[];
    // Vale la del mismo canal, sin canal, o en un canal que ya no está conectado
    // (p.ej. el lead de GHL se creó apuntando a un canal caído o sustituido).
    let conv: Record<string, any> | undefined;
    for (const c of candidates) {
      if (!c.channel_id || c.channel_id === channel.id) {
        conv = c;
        break;
      }
      const { data: other } = await this.supabase.admin
        .from('channels')
        .select('status')
        .eq('id', c.channel_id as string)
        .maybeSingle();
      if (!other || other.status !== 'connected') {
        conv = c;
        break;
      }
    }
    if (!conv) return null;

    const { data: linked } = await this.supabase.admin
      .from('conversations')
      .update({
        unipile_chat_id: chatId,
        contact_external_id: chatId,
        channel_id: channel.id,
        contact_handle: phone,
      })
      .eq('id', conv.id)
      .is('unipile_chat_id', null)
      .select(cols);
    if (!linked?.length) return this.findByChat(orgId, channel.id, chatId, cols);
    this.logger.log(`Chat ${chatId} vinculado a la conversación existente ${conv.id as string}`);
    return linked[0] as unknown as Record<string, any>;
  }

  /**
   * Lead recién entrado cuyo chat ya existe en WhatsApp (GHL le envió la
   * plantilla antes de avisarnos): lo buscamos entre los chats recientes de la
   * cuenta y lo vinculamos, para que el portal muestre lo que se le ha enviado.
   */
  async linkRecentChatByPhone(
    orgId: string,
    channel: { id: string; provider: string; unipile_account_id?: string | null },
    phone: string,
  ): Promise<string | null> {
    const wanted = phone.replace(/\D/g, '');
    if (!channel.unipile_account_id || wanted.length < 6) return null;
    try {
      const chats = await this.unipile.listChats(channel.unipile_account_id, 15);
      const since = Date.now() - RECENT_CHAT_MS;
      for (const chat of chats) {
        if (!chat.id) continue;
        const ts = Date.parse(String(chat.timestamp ?? ''));
        if (Number.isFinite(ts) && ts < since) continue;
        const chatPhone =
          phoneFromJid(chat.attendee_provider_id) ??
          phoneFromJid(chat.provider_id) ??
          (await this.chatContact(chat.id)).phone;
        if (!samePhone(chatPhone, wanted)) continue;
        const linked = await this.linkIntakeConversation(orgId, channel, chat.id, chatPhone as string, 'id');
        if (!linked) return null;
        await this.importFirstContact(orgId, linked.id as string, chat.id);
        return chat.id;
      }
    } catch (err) {
      this.logger.warn(`No se pudo buscar el chat reciente de ${phone}: ${String(err)}`);
    }
    return null;
  }

  /** Guarda lo que ya se le envió al lead antes de vincular su chat y arranca los seguimientos. */
  private async importFirstContact(orgId: string, conversationId: string, chatId: string) {
    const msgs = await this.unipile.listChatMessages(chatId, 10);
    if (msgs.some((m) => !(m.is_sender === 1 || m.is_sender === true))) return;
    let latest: string | null = null;
    for (const m of [...msgs].reverse()) {
      const text = (m.text ?? '').trim();
      if (!m.id || !text || (await this.messageExists(conversationId, String(m.id)))) continue;
      const at = new Date(String(m.timestamp ?? m.date ?? Date.now())).toISOString();
      await this.supabase.admin.from('messages').insert({
        conversation_id: conversationId,
        organization_id: orgId,
        role: 'agent',
        content: text,
        created_at: at,
        metadata: { message_id: String(m.id), source: 'external_first_contact' },
      });
      if (!latest || at > latest) latest = at;
    }
    if (!latest) return;
    await this.supabase.admin
      .from('conversations')
      .update({ last_message_at: latest })
      .eq('id', conversationId);
    await this.startFollowUpsAfterFirstContact(conversationId, latest);
  }

  private async upsertConversation(
    orgId: string,
    channel: { id: string; provider: string },
    evt: IncomingEvent,
  ) {
    const existing = await this.findByChat(orgId, channel.id, evt.chatId);
    if (existing) return existing;

    const fromJid = phoneFromJid(evt.senderProviderId);
    const contact = fromJid
      ? { name: null, phone: fromJid }
      : await this.chatContact(evt.chatId);
    if (contact.phone) {
      const linked = await this.linkIntakeConversation(orgId, channel, evt.chatId, contact.phone);
      if (linked) return linked;
    }

    // La IA solo arranca encendida si hay un agente predeterminado para
    // conversaciones nuevas; si no, se activa desde el inbox, un workflow o GHL.
    const initial = await this.agents.initialForConversation(orgId, channel.id);
    const name =
      [evt.senderName, contact.name].find((n) => !isPlaceholderName(n)) ??
      evt.senderName ??
      contact.name ??
      'Lead';
    const { data: created, error } = await this.supabase.admin
      .from('conversations')
      .insert({
        organization_id: orgId,
        channel_id: channel.id,
        provider: channel.provider,
        contact_external_id: evt.chatId,
        unipile_chat_id: evt.chatId,
        contact_handle: contact.phone ?? evt.senderProviderId ?? null,
        contact_name: name,
        is_test: false,
        ai_enabled: initial.ai_enabled && !newConversationsStartPaused(),
        stage: initial.stage,
      })
      .select(CONV_COLS)
      .single();
    if (error) throw error;

    // Dispara el workflow "Cuando entra una conversación nueva" (si existe).
    void this.workflowTrigger.fire(orgId, created.id as string, 'conversation_created');
    return created;
  }

}

/**
 * Algunos webhooks llegan con un content-type que Express parsea mal y dejan
 * todo el JSON como una única clave. Lo detectamos y reparseamos.
 */
/**
 * Unifica la forma de los adjuntos: la API devuelve `{id,type,mimetype,…}` y el
 * webhook `{attachment_id,attachment_type,attachment_size,…}`.
 */
function normalizeAttachments(raw: unknown): UnipileAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      ...a,
      id: String(a.id ?? a.attachment_id ?? ''),
      type: (a.type ?? a.attachment_type) as string | undefined,
      mimetype: (a.mimetype ?? a.attachment_mimetype ?? a.mime_type) as string | undefined,
      file_name: (a.file_name ?? a.attachment_name ?? a.name) as string | undefined,
      file_size: (a.file_size ?? a.attachment_size) as number | undefined,
    }));
}

/** Copia del payload acotada para guardarla en el panel de errores. */
function truncateForLog(payload: unknown): Record<string, unknown> {
  try {
    const json = JSON.stringify(payload);
    return json.length > 6000 ? { truncated: json.slice(0, 6000) } : (JSON.parse(json) as Record<string, unknown>);
  } catch {
    return { unserializable: true };
  }
}

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

/**
 * ¿El webhook corresponde a un mensaje que enviamos NOSOTROS? Miramos varias
 * señales conocidas del payload de Unipile para no responder a nuestros propios
 * mensajes (evita bucles) sin depender de la lista de mensajes (que va con retraso).
 */
function isFromSelf(payload: Record<string, unknown>): boolean {
  if (payload.is_sender === true || payload.is_sender === 1) return true;
  const sender = (payload.sender ?? {}) as Record<string, unknown>;
  if (sender.is_self === true || sender.is_self === 1) return true;
  const message = (payload.message ?? {}) as Record<string, unknown>;
  if (message && typeof message === 'object') {
    if (message.is_sender === true || message.is_sender === 1) return true;
  }
  const event = String(payload.event ?? payload.event_type ?? '').toLowerCase();
  if (event.includes('message_sent')) return true;
  return false;
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

/** Texto comparable entre lo que guardamos y lo que devuelve WhatsApp. */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** Hora del día (0-23) de un instante en la zona horaria indicada (IANA). */
function hourInTz(dateMs: number, tz: string): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: tz || 'UTC',
    }).format(new Date(dateMs));
    const h = parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : new Date(dateMs).getUTCHours();
  } catch {
    // Zona horaria inválida → caemos a UTC en lugar de romper.
    return new Date(dateMs).getUTCHours();
  }
}

function withinWindow(hour: number, start: number, end: number): boolean {
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** ¿Estamos dentro del horario activo, evaluado en la zona horaria de la org? */
function inActiveHours(start: number, end: number, tz: string): boolean {
  return withinWindow(hourInTz(Date.now(), tz), start, end);
}

/**
 * Devuelve el momento (ms) en que se puede enviar respetando el horario activo,
 * evaluado en la zona horaria de la organización. Si la franja está desactivada
 * o ya estamos dentro, devuelve `slotMs` tal cual; si no, lo empuja hora a hora
 * hasta la próxima franja activa.
 */
function nextActiveSlot(
  slotMs: number,
  enabled: boolean,
  start: number,
  end: number,
  tz: string,
): number {
  if (!enabled) return slotMs;
  if (withinWindow(hourInTz(slotMs, tz), start, end)) return slotMs;

  const next = new Date(slotMs);
  next.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    next.setUTCHours(next.getUTCHours() + 1);
    if (withinWindow(hourInTz(next.getTime(), tz), start, end)) return next.getTime();
  }
  return slotMs;
}

/**
 * Normaliza un enlace (o un texto que lo contenga) para comparar: minúsculas,
 * sin protocolo, sin "www." ni barra final. Así "https://www.x.com/agenda/"
 * y "x.com/agenda" coinciden.
 */
function normalizeLink(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/(^|\s)www\./g, '$1')
    .replace(/\/(?=\s|$)/g, '')
    .trim();
}
