import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { SetterConfigService } from '../setter/setter-config.service';
import {
  UnipileService,
  type UnipileChat,
  type UnipileMessage,
} from '../unipile/unipile.service';
import { betterName, isPlaceholderName } from '../common/phone';
import { MessagingService, normalizeForCompare } from '../messaging/messaging.service';
import { ConversionsApiService } from '../whatsapp-cloud/conversions-api.service';
import { TagsService } from '../tags/tags.service';
import { StagesService } from '../stages/stages.service';
import { AgentsService } from '../agents/agents.service';

type FunnelStage = string;

type ListFilters = {
  stage?: string;
  provider?: string;
  agentId?: string;
  pipelineId?: string;
  search?: string;
  aiEnabled?: boolean;
};

type FilterableQuery<Q> = {
  eq(col: string, val: unknown): Q;
  in(col: string, vals: unknown[]): Q;
  or(filters: string): Q;
};

const MAX_CHATS = 40;
const MAX_MESSAGES = 25;
/** Mismo texto y mismo lado dentro de esta ventana = mismo mensaje (aunque cambie el id). */
const SAME_MESSAGE_WINDOW_MS = 3 * 60_000;

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly unipile: UnipileService,
    private readonly messaging: MessagingService,
    private readonly capi: ConversionsApiService,
    private readonly tags: TagsService,
    private readonly setterConfig: SetterConfigService,
    private readonly stages: StagesService,
    private readonly agents: AgentsService,
  ) {}

  async list(
    orgId: string,
    stage?: string,
    archived = false,
    opts: Omit<ListFilters, 'stage'> = {},
  ) {
    let query = this.supabase.admin
      .from('conversations')
      .select(
        'id, provider, contact_name, contact_handle, stage, mode, suggested_mode, ai_enabled, blocked, unread_count, last_message_at, created_at, agent_id, channel_id',
      )
      .eq('organization_id', orgId)
      .eq('is_test', false)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      // Mostramos los más recientes. Reduce el payload y acelera la navegación;
      // los antiguos siguen accesibles por búsqueda/filtros.
      .limit(60);

    // Por defecto ocultamos las conversaciones archivadas (canales desconectados).
    query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

    const filters = { ...opts, stage };
    query = this.applyFilters(query, filters, await this.pipelineKeys(orgId, filters));

    const { data, error } = await query;
    if (error) throw error;
    const convs = data ?? [];
    if (convs.length === 0) return convs;

    // Adjuntamos las etiquetas de cada conversación en 2 consultas (evita N+1).
    const ids = convs.map((c) => c.id as string);
    const { data: applied } = await this.supabase.admin
      .from('conversation_tags')
      .select('conversation_id, tag_id, source')
      .eq('organization_id', orgId)
      .in('conversation_id', ids);
    const rows = applied ?? [];
    if (rows.length === 0) {
      return convs.map((c) => ({ ...c, tags: [] }));
    }

    const tagIds = [...new Set(rows.map((r) => r.tag_id as string))];
    const { data: defs } = await this.supabase.admin
      .from('tag_definitions')
      .select('id, name, color')
      .in('id', tagIds);
    const byId = new Map((defs ?? []).map((d) => [d.id as string, d]));

    const byConv = new Map<string, Array<{ tag_id: string; name: string; color: string; source: string }>>();
    for (const r of rows) {
      const def = byId.get(r.tag_id as string);
      if (!def) continue;
      const arr = byConv.get(r.conversation_id as string) ?? [];
      arr.push({
        tag_id: r.tag_id as string,
        name: def.name as string,
        color: def.color as string,
        source: (r.source as string) ?? 'ai',
      });
      byConv.set(r.conversation_id as string, arr);
    }

    return convs.map((c) => ({ ...c, tags: byConv.get(c.id as string) ?? [] }));
  }

  /** Claves de stage del pipeline filtrado (null = sin filtro de pipeline). */
  private async pipelineKeys(orgId: string, f: ListFilters): Promise<string[] | null> {
    if (!f.pipelineId || f.stage) return null;
    const keys = (await this.stages.list(orgId))
      .filter((s) => s.pipeline_id === f.pipelineId)
      .map((s) => s.key);
    return keys.length > 0 ? keys : ['__none__'];
  }

  // Síncrona a propósito: un `await` sobre el builder de Supabase lo ejecutaría.
  private applyFilters<Q extends FilterableQuery<Q>>(q: Q, f: ListFilters, stageKeys: string[] | null): Q {
    if (f.stage) q = q.eq('stage', f.stage);
    if (f.provider) q = q.eq('provider', f.provider);
    if (f.agentId) q = q.eq('agent_id', f.agentId);
    if (f.aiEnabled !== undefined) q = q.eq('ai_enabled', f.aiEnabled);
    if (f.search) {
      // Nombre o teléfono; el teléfono se busca solo por dígitos (ignora espacios y +).
      const term = f.search.replace(/[%_,()*\\]/g, ' ').trim();
      const digits = term.replace(/\D/g, '');
      const ors = [`contact_name.ilike.*${term}*`];
      if (digits.length >= 3) ors.push(`contact_handle.ilike.*${digits}*`);
      if (term) q = q.or(ors.join(','));
    }
    if (stageKeys) q = q.in('stage', stageKeys);
    return q;
  }

  async get(orgId: string, id: string, refresh = true) {
    const conv = await this.assertOwned(orgId, id);

    // Trae el historial reciente desde Unipile (rellena lo que no vino por
    // webhook). Es la llamada MÁS lenta, así que solo la hacemos al ABRIR el chat
    // (`refresh`), no en cada refresco automático: los mensajes nuevos entrantes
    // ya llegan por webhook a la BD, y el poll los lee sin tocar Unipile.
    if (refresh && conv.unipile_chat_id) {
      try {
        await this.importMessages(orgId, id, conv.unipile_chat_id as string, MAX_MESSAGES);
      } catch (err) {
        this.logger.warn(`No se pudo refrescar historial: ${String(err)}`);
      }

      // Resolvemos por los participantes del chat lo que falte:
      //  - el nombre, si sigue como 'Lead' o vacío
      //  - el teléfono real, si el handle es un id interno (@lid / @...) o falta
      const needName = isPlaceholderName(conv.contact_name);
      const needPhone = !conv.contact_handle || conv.contact_handle.includes('@');
      if (needName || needPhone) {
        const { name, handle } = await this.resolveAttendee(conv.unipile_chat_id as string);
        const update: Record<string, unknown> = {};
        const better = betterName(conv.contact_name, name);
        if (better) {
          conv.contact_name = better;
          update.contact_name = better;
        }
        if (needPhone && handle) {
          conv.contact_handle = handle;
          update.contact_handle = handle;
        }
        if (Object.keys(update).length > 0) {
          await this.supabase.admin.from('conversations').update(update).eq('id', id);
        }
      }
    }

    // Solo los últimos 200 mensajes (los más recientes). Acelera la carga de
    // chats largos; el orden final es ascendente para pintarlos de arriba a abajo.
    const { data: recent } = await this.supabase.admin
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(200);
    const messages = (recent ?? []).reverse();

    if ((conv.unread_count ?? 0) > 0) {
      await this.supabase.admin
        .from('conversations')
        .update({ unread_count: 0 })
        .eq('id', id);
    }

    const tags = await this.tags.tagsForConversation(orgId, id);

    return { conversation: { ...conv, unread_count: 0, tags }, messages };
  }

  /**
   * Acciones en bloque sobre varias conversaciones (o todas las que cumplen los
   * filtros con `all`): activar/pausar la IA y/o cambiar el agente que atiende.
   */
  async bulk(
    orgId: string,
    input: {
      ids?: string[];
      all?: boolean;
      filters?: ListFilters;
      ai_enabled?: boolean;
      agent_id?: string | null;
    },
  ): Promise<{ updated: number }> {
    let ids = [...new Set(input.ids ?? [])];
    if (input.all) {
      let q = this.supabase.admin
        .from('conversations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('is_test', false)
        .is('archived_at', null)
        .limit(5000);
      const filters = input.filters ?? {};
      q = this.applyFilters(q, filters, await this.pipelineKeys(orgId, filters));
      const { data } = await q;
      ids = (data ?? []).map((r) => r.id as string);
    }
    if (ids.length === 0) return { updated: 0 };

    // Solo conversaciones de esta organización.
    const { data: owned } = await this.supabase.admin
      .from('conversations')
      .select('id, stage, blocked')
      .eq('organization_id', orgId)
      .in('id', ids.slice(0, 5000));
    const rows = owned ?? [];
    if (rows.length === 0) return { updated: 0 };

    if (input.agent_id !== undefined) {
      const agent = input.agent_id ? await this.agents.get(orgId, input.agent_id) : null;
      // Agrupamos por etapa destino para no hacer una escritura por chat.
      const byStage = new Map<string | null, string[]>();
      for (const r of rows) {
        const next = agent
          ? await this.agents.stageForAgent(orgId, agent, (r.stage as string) ?? null)
          : null;
        const list = byStage.get(next) ?? [];
        list.push(r.id as string);
        byStage.set(next, list);
      }
      for (const [stage, group] of byStage) {
        await this.supabase.admin
          .from('conversations')
          .update({ agent_id: agent?.id ?? null, ...(stage ? { stage } : {}) })
          .eq('organization_id', orgId)
          .in('id', group);
        if (stage) {
          await this.supabase.admin
            .from('leads')
            .update({ status: stage })
            .eq('organization_id', orgId)
            .in('conversation_id', group);
        }
      }
    }
    if (typeof input.ai_enabled === 'boolean') {
      // A un contacto bloqueado nunca se le activa la IA.
      const target = input.ai_enabled ? rows.filter((r) => !r.blocked) : rows;
      if (target.length > 0) {
        await this.supabase.admin
          .from('conversations')
          .update({ ai_enabled: input.ai_enabled })
          .eq('organization_id', orgId)
          .in(
            'id',
            target.map((r) => r.id as string),
          );
      }
    }
    return { updated: rows.length };
  }

  async update(
    orgId: string,
    id: string,
    patch: {
      ai_enabled?: boolean;
      stage?: FunnelStage;
      mode?: 'setter' | 'support' | 'ignored';
      notes?: string;
      blocked?: boolean;
      unread?: boolean;
      assigned_to?: string | null;
      agent_id?: string | null;
    },
  ) {
    await this.assertOwned(orgId, id);
    const update: Record<string, unknown> = {};
    if (typeof patch.ai_enabled === 'boolean') update.ai_enabled = patch.ai_enabled;
    if (patch.stage) {
      await this.stages.assertValidKey(orgId, patch.stage);
      update.stage = patch.stage;
    }
    // Cambiar el agente que atiende este chat (cadena vacía / null = el del canal).
    // Si su etapa no es del pipeline del nuevo agente, pasa a la primera de ese.
    if (patch.agent_id !== undefined) {
      update.agent_id = patch.agent_id ? patch.agent_id : null;
      if (patch.agent_id && !patch.stage) {
        const agent = await this.agents.get(orgId, patch.agent_id);
        const { data: cur } = await this.supabase.admin
          .from('conversations')
          .select('stage')
          .eq('id', id)
          .maybeSingle();
        const next = await this.agents.stageForAgent(orgId, agent, (cur?.stage as string) ?? null);
        if (next) update.stage = next;
      } else if (patch.agent_id) {
        await this.agents.get(orgId, patch.agent_id);
      }
    }
    if (patch.mode) {
      // Si el usuario fija el modo a mano, lo bloqueamos (no reclasificar) y
      // resolvemos cualquier sugerencia pendiente de la IA.
      update.mode = patch.mode;
      update.mode_locked = true;
      update.suggested_mode = null;
    }
    if (typeof patch.notes === 'string') update.notes = patch.notes;
    if (typeof patch.unread === 'boolean') update.unread_count = patch.unread ? 1 : 0;
    // Asignar (o desasignar con cadena vacía / null) el chat a un miembro.
    if (patch.assigned_to !== undefined) {
      update.assigned_to = patch.assigned_to ? patch.assigned_to : null;
    }
    if (typeof patch.blocked === 'boolean') {
      update.blocked = patch.blocked;
      // Al bloquear, la IA deja de responder a este contacto.
      if (patch.blocked) update.ai_enabled = false;
    }

    const { data, error } = await this.supabase.admin
      .from('conversations')
      .update(update)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('id, stage, mode, ai_enabled, blocked, notes, unread_count, assigned_to, agent_id')
      .single();
    if (error) throw error;

    // Mantenemos el CRM sincronizado: si cambia la etapa, actualizamos el lead.
    const newStage = (update.stage as string | undefined) ?? undefined;
    if (newStage) {
      await this.supabase.admin
        .from('leads')
        .update({ status: newStage })
        .eq('organization_id', orgId)
        .eq('conversation_id', id);
      // Workflows con trigger "Al cambiar de estado".
      void this.stages.fireStageWorkflows(orgId, id, newStage);
    }

    // Atribución a Meta: al CUALIFICAR (o GANAR) un lead que vino de un anuncio
    // click-to-WhatsApp, devolvemos el evento a la Conversions API.
    if (patch.stage === 'qualified' || patch.stage === 'won') {
      void this.maybeReportConversion(orgId, id, patch.stage);
    }
    return data;
  }

  /** Envía el evento de conversión a Meta si la conversación trae `ctwa_clid`. */
  private async maybeReportConversion(orgId: string, id: string, stage: FunnelStage) {
    try {
      const { data: conv } = await this.supabase.admin
        .from('conversations')
        .select('referral, contact_handle')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle();
      const ctwaClid = (conv?.referral as { ctwa_clid?: string } | null)?.ctwa_clid;
      if (!ctwaClid) return;
      await this.capi.sendConversion({
        orgId,
        conversationId: id,
        ctwaClid,
        eventName: stage === 'won' ? 'Purchase' : 'Lead',
        phone: conv?.contact_handle as string | null,
      });
    } catch (err) {
      this.logger.warn(`No se pudo reportar conversión a Meta: ${String(err)}`);
    }
  }

  async remove(orgId: string, id: string) {
    await this.assertOwned(orgId, id);
    const { error } = await this.supabase.admin
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw error;
    return { ok: true };
  }

  async sendAgentMessage(orgId: string, id: string, content: string) {
    await this.assertOwned(orgId, id);
    return this.messaging.sendAgentMessage(orgId, id, content);
  }

  /**
   * Convierte una conversación real en un "ejemplo ganador" del setter: arma el
   * transcript (Lead / Setter) y lo AÑADE a `winning_examples` para que el bot
   * aprenda de ella (few-shot en el prompt). No sobreescribe lo que ya había.
   */
  async promoteToExample(orgId: string, id: string) {
    const conv = await this.assertOwned(orgId, id);

    // Refrescamos historial desde Unipile por si falta algún mensaje reciente.
    if (conv.unipile_chat_id) {
      try {
        await this.importMessages(
          orgId,
          id,
          conv.unipile_chat_id as string,
          MAX_MESSAGES,
        );
      } catch (err) {
        this.logger.warn(`No se pudo refrescar historial: ${String(err)}`);
      }
    }

    const { data: messages } = await this.supabase.admin
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    const transcript = buildTranscript(messages ?? []);
    if (transcript.turns < 2) {
      throw new BadRequestException(
        'La conversación no tiene suficientes mensajes para usarla como ejemplo.',
      );
    }

    const date = new Date().toISOString().slice(0, 10);
    const header = `===== CONVERSACIÓN: ${conv.contact_name || 'Lead'} (${date}) =====`;
    const block = `${header}\n${transcript.text}`;

    // El ejemplo entrena al AGENTE que atiende esta conversación.
    const agent = await this.agents.resolveForConversation(orgId, {
      agent_id: (conv.agent_id as string | null) ?? null,
      channel_id: (conv.channel_id as string | null) ?? null,
      mode: (conv.mode as string | null) ?? null,
    });
    if (!agent) throw new BadRequestException('No hay ningún agente al que añadir el ejemplo.');
    const combined = agent.winning_examples ? `${agent.winning_examples}\n\n${block}` : block;
    const winning_examples = combined.slice(0, 58000);
    await this.agents.update(orgId, agent.id, { winning_examples });

    return {
      ok: true,
      turns: transcript.turns,
      addedChars: block.length,
      totalChars: winning_examples.length,
      truncated: combined.length > winning_examples.length,
    };
  }

  /** Devuelve el transcript en texto plano (Lead / Setter) de una conversación. */
  async exportTranscript(orgId: string, id: string) {
    const conv = await this.assertOwned(orgId, id);
    if (conv.unipile_chat_id) {
      try {
        await this.importMessages(
          orgId,
          id,
          conv.unipile_chat_id as string,
          MAX_MESSAGES,
        );
      } catch (err) {
        this.logger.warn(`No se pudo refrescar historial: ${String(err)}`);
      }
    }
    const { data: messages } = await this.supabase.admin
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    const transcript = buildTranscript(messages ?? []);
    const date = new Date().toISOString().slice(0, 10);
    const md = `# Conversación con ${conv.contact_name || 'Lead'}\n\n_${conv.contact_handle ?? ''} · ${date}_\n\n${transcript.text}\n`;
    return {
      filename: `conversacion-${(conv.contact_name || 'lead').replace(/[^\w-]+/g, '_')}-${date}.md`,
      content: md,
      turns: transcript.turns,
    };
  }

  /**
   * Nombre + teléfono real del contacto a partir de los participantes del chat.
   * El teléfono viene en `specifics.phone_number` o en `public_identifier`
   * (`<num>@s.whatsapp.net`); `provider_id` suele ser el id interno `@lid`.
   */
  private async resolveAttendee(chatId: string): Promise<{ name?: string; handle?: string }> {
    const { name, phone } = await this.messaging.chatContact(chatId);
    return { name: name ?? undefined, handle: phone ?? undefined };
  }

  /**
   * Sincroniza los chats de WhatsApp/IG/etc. desde Unipile. Los chats antiguos
   * se importan con la IA DESACTIVADA (no queremos que el bot escriba a contactos
   * antiguos de golpe); el usuario la activa por chat cuando quiera.
   */
  async sync(orgId: string) {
    const { data: channels } = await this.supabase.admin
      .from('channels')
      .select('id, provider, unipile_account_id')
      .eq('organization_id', orgId)
      .eq('status', 'connected')
      .not('unipile_account_id', 'is', null);

    let chatsSeen = 0;

    for (const channel of channels ?? []) {
      let chats: UnipileChat[] = [];
      try {
        chats = await this.unipile.listChats(channel.unipile_account_id as string, MAX_CHATS);
      } catch (err) {
        this.logger.error(`No se pudieron listar chats: ${String(err)}`);
        continue;
      }

      for (const chat of chats) {
        if (!chat.id) continue;
        chatsSeen += 1;
        // Solo creamos la conversación; el historial se carga al abrir el chat
        // (get → importMessages), igual que WhatsApp Web. Así el sync es rápido.
        await this.upsertSyncedConversation(orgId, channel, chat);
      }
    }

    return { channels: channels?.length ?? 0, chats: chatsSeen };
  }

  // ---------------------------------------------------------------------------

  private async importMessages(
    orgId: string,
    convId: string,
    chatId: string,
    limit: number,
  ): Promise<number> {
    const msgs = await this.unipile.listChatMessages(chatId, limit);
    if (!msgs.length) return 0;

    const { data: existing } = await this.supabase.admin
      .from('messages')
      .select('id, role, content, metadata, created_at')
      .eq('conversation_id', convId);

    // IDs de proveedor ya guardados: no se reimportan.
    const seen = new Set(
      (existing ?? [])
        .map((m) => (m.metadata as { message_id?: string } | null)?.message_id)
        .filter(Boolean) as string[],
    );

    // Mensajes que YA guardamos al enviar/recibir pero sin `message_id`
    // (los salientes del bot se persisten con metadata vacía). Los reconciliamos
    // con el eco de Unipile en lugar de duplicarlos. Clave: lado + contenido.
    const unreconciled = new Map<
      string,
      { id: string; meta: Record<string, unknown> }[]
    >();
    for (const m of existing ?? []) {
      const meta = (m.metadata as Record<string, unknown> | null) ?? {};
      if (meta.message_id) continue;
      const role = m.role as string;
      const side =
        role === 'contact' ? 'in' : role === 'assistant' || role === 'agent' ? 'out' : null;
      if (!side) continue;
      const key = `${side}::${String(m.content ?? '').trim()}`;
      const arr = unreconciled.get(key) ?? [];
      arr.push({ id: m.id as string, meta });
      unreconciled.set(key, arr);
    }

    // Mensajes ya guardados CON id. WhatsApp puede cambiar el id de un mensaje
    // nuestro entre el envío y la sincronización, así que, además del id, un
    // mensaje del mismo lado con el mismo texto y hora cercana es el mismo.
    const known: { side: 'in' | 'out'; text: string; at: number }[] = [];
    for (const m of existing ?? []) {
      const meta = (m.metadata as Record<string, unknown> | null) ?? {};
      if (!meta.message_id) continue;
      const role = m.role as string;
      const side =
        role === 'contact' ? 'in' : role === 'assistant' || role === 'agent' ? 'out' : null;
      if (!side) continue;
      known.push({
        side,
        text: normalizeForCompare(String(m.content ?? '')),
        at: new Date(m.created_at as string).getTime(),
      });
    }
    const alreadyStored = (side: 'in' | 'out', text: string, at: string) => {
      const t = normalizeForCompare(text);
      const ms = new Date(at).getTime();
      return known.some((k) => k.side === side && k.text === t && Math.abs(k.at - ms) < SAME_MESSAGE_WINDOW_MS);
    };

    const rows: Array<{
      conversation_id: string;
      organization_id: string;
      role: 'assistant' | 'contact';
      content: string;
      created_at: string;
      metadata: Record<string, unknown>;
    }> = [];
    const backfills: { id: string; metadata: Record<string, unknown> }[] = [];

    for (const m of msgs) {
      const id = m.id ? String(m.id) : '';
      const text = (m.text ?? '').trim();
      if (!id || !text || seen.has(id)) continue;

      const side = isFromUs(m) ? 'out' : 'in';
      if (alreadyStored(side, text, timestampOf(m))) {
        seen.add(id);
        continue;
      }

      const key = `${side}::${text}`;
      const pool = unreconciled.get(key);
      if (pool && pool.length > 0) {
        // Ya lo teníamos guardado sin id: rellenamos el message_id y NO duplicamos.
        const row = pool.shift()!;
        backfills.push({
          id: row.id,
          metadata: { ...row.meta, message_id: id, reconciled: true },
        });
        seen.add(id);
        continue;
      }

      rows.push({
        conversation_id: convId,
        organization_id: orgId,
        role: isFromUs(m) ? ('assistant' as const) : ('contact' as const),
        content: text,
        created_at: timestampOf(m),
        metadata: { message_id: id, imported: true },
      });
    }

    // Backfill de message_id en filas existentes (evita duplicados en futuros syncs).
    for (const b of backfills) {
      await this.supabase.admin
        .from('messages')
        .update({ metadata: b.metadata })
        .eq('id', b.id);
    }

    if (rows.length === 0) return 0;

    const { error } = await this.supabase.admin.from('messages').insert(rows);
    if (error) {
      this.logger.error(`Error importando mensajes: ${error.message}`);
      return 0;
    }

    // Actualiza last_message_at con el mensaje más reciente.
    const latest = rows.reduce((a, b) => (a.created_at > b.created_at ? a : b));
    await this.supabase.admin
      .from('conversations')
      .update({ last_message_at: latest.created_at })
      .eq('id', convId);

    const outgoing = rows.filter((r) => r.role === 'assistant');
    if (outgoing.length > 0 && outgoing.length === rows.length) {
      const sentAt = outgoing.reduce((a, b) => (a.created_at > b.created_at ? a : b)).created_at;
      await this.messaging.startFollowUpsAfterFirstContact(convId, sentAt);
    }

    return rows.length;
  }

  private async upsertSyncedConversation(
    orgId: string,
    channel: { id: string; provider: string },
    chat: UnipileChat,
  ) {
    const cols = 'id, contact_name, contact_handle';
    let existing = await this.messaging.findByChat(orgId, channel.id, chat.id, cols);

    // Nombre y teléfono reales: el chat trae `name` en grupos; en WhatsApp 1:1
    // tanto el nombre como el teléfono salen de los participantes.
    let name = chat.name?.trim();
    let handle: string | null = null;
    const resolved = await this.resolveAttendee(chat.id);
    if (!name && resolved.name) name = resolved.name;
    if (resolved.handle) handle = resolved.handle;

    // Si ese teléfono ya entró como lead (GHL/formulario), el chat se vincula a
    // su conversación: así no aparece duplicado ni con la IA en pausa.
    if (!existing && handle) {
      existing = await this.messaging.linkIntakeConversation(orgId, channel, chat.id, handle, cols);
    }

    if (existing) {
      const update: Record<string, unknown> = {};
      const better = betterName(existing.contact_name as string | null, name);
      if (better) update.contact_name = better;
      if (handle && handle !== existing.contact_handle) update.contact_handle = handle;
      if (Object.keys(update).length > 0) {
        await this.supabase.admin
          .from('conversations')
          .update(update)
          .eq('id', existing.id);
      }
      return existing;
    }

    const { data: created, error } = await this.supabase.admin
      .from('conversations')
      .insert({
        organization_id: orgId,
        channel_id: channel.id,
        provider: channel.provider,
        contact_external_id: chat.id,
        unipile_chat_id: chat.id,
        contact_handle: handle,
        contact_name: name ?? 'Lead',
        is_test: false,
        ai_enabled: false, // chats antiguos: IA en pausa por defecto
        stage: 'new',
        last_message_at: timestampOrNull(chat.timestamp),
      })
      .select('id, contact_name')
      .single();
    if (error) throw error;
    return created;
  }

  private async assertOwned(orgId: string, id: string) {
    const { data } = await this.supabase.admin
      .from('conversations')
      .select(
        'id, provider, contact_name, contact_handle, stage, mode, mode_locked, suggested_mode, ai_enabled, blocked, notes, unread_count, assigned_to, unipile_chat_id, ai_analysis, ai_analysis_at, last_message_at, created_at, agent_id, channel_id',
      )
      .eq('id', id)
      .eq('organization_id', orgId)
      .eq('is_test', false)
      .maybeSingle();
    if (!data) throw new NotFoundException('Conversación no encontrada');
    return data;
  }

  /** Miembros de la organización (para asignar chats). */
  async members(orgId: string) {
    const { data: mems } = await this.supabase.admin
      .from('memberships')
      .select('user_id, role')
      .eq('organization_id', orgId);
    const ids = (mems ?? []).map((m) => m.user_id as string);
    if (ids.length === 0) return [];
    const { data: profiles } = await this.supabase.admin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', ids);
    const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    return (mems ?? []).map((m) => {
      const p = byId.get(m.user_id as string);
      return {
        user_id: m.user_id as string,
        role: m.role as string,
        email: (p?.email as string) ?? null,
        full_name: (p?.full_name as string) ?? null,
      };
    });
  }
}

/**
 * Convierte la lista de mensajes de una conversación en un transcript de texto
 * plano con etiquetas `Lead:` / `Setter:`. Ignora mensajes de sistema y vacíos.
 */
function buildTranscript(
  messages: Array<{ role?: string | null; content?: string | null }>,
): { text: string; turns: number } {
  const lines: string[] = [];
  for (const m of messages) {
    const role = String(m.role ?? '');
    const text = String(m.content ?? '').trim();
    if (!text) continue;
    let who: string | null = null;
    if (role === 'contact') who = 'Lead';
    else if (role === 'assistant' || role === 'agent') who = 'Setter';
    if (!who) continue;
    lines.push(`${who}: ${text}`);
  }
  return { text: lines.join('\n'), turns: lines.length };
}

function isFromUs(m: UnipileMessage): boolean {
  return m.is_sender === 1 || m.is_sender === true;
}

function timestampOf(m: UnipileMessage): string {
  const raw = m.timestamp ?? m.date;
  const d = raw ? new Date(raw) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function timestampOrNull(raw?: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
