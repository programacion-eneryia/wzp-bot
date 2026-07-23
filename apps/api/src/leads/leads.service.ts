import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/** Datos con los que se registra/actualiza un lead en el CRM. */
export type RecordLeadInput = {
  conversationId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  provider?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  campaign?: string | null;
  externalId?: string | null;
  firstMessage?: string | null;
  consentOptin?: boolean;
  /** Campos personalizados del formulario (clave/valor). */
  fields?: Record<string, unknown>;
  /** Payload original completo, tal cual llegó. */
  raw?: Record<string, unknown>;
};

export type LeadPatch = {
  status?: string;
  notes?: string;
  name?: string;
  email?: string;
};

const LEAD_COLUMNS =
  'id, organization_id, conversation_id, name, phone, email, provider, source, source_detail, campaign, external_id, status, consent_optin, first_message, fields, raw, notes, created_at, updated_at';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Registra un lead en el CRM (o actualiza el existente). Deduplica por id
   * externo, luego por teléfono, luego por email dentro de la organización.
   * Se llama SIEMPRE que entra un lead, antes de que el bot le escriba.
   */
  async record(orgId: string, input: RecordLeadInput) {
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    const externalId = input.externalId?.trim() || null;

    const existing = await this.findExisting(orgId, externalId, phone, email);

    if (existing) {
      const update: Record<string, unknown> = {};
      // Solo rellenamos lo que falta o llega nuevo (no pisamos datos buenos).
      if (input.name && (!existing.name || existing.name === 'Lead')) update.name = input.name;
      if (phone && !existing.phone) update.phone = phone;
      if (email && !existing.email) update.email = email;
      if (input.provider && !existing.provider) update.provider = input.provider;
      if (input.source && !existing.source) update.source = input.source;
      if (input.sourceDetail && !existing.source_detail) update.source_detail = input.sourceDetail;
      if (input.campaign && !existing.campaign) update.campaign = input.campaign;
      if (externalId && !existing.external_id) update.external_id = externalId;
      if (input.conversationId && !existing.conversation_id)
        update.conversation_id = input.conversationId;
      if (input.firstMessage && !existing.first_message) update.first_message = input.firstMessage;
      if (input.consentOptin) update.consent_optin = true;
      // Fusionamos payloads: conservamos lo anterior y añadimos lo nuevo.
      if (input.raw && Object.keys(input.raw).length > 0) {
        update.raw = { ...(existing.raw as object | null), ...input.raw };
      }
      if (input.fields && Object.keys(input.fields).length > 0) {
        update.fields = { ...(existing.fields as object | null), ...input.fields };
      }

      if (Object.keys(update).length === 0) return existing;

      const { data, error } = await this.supabase.admin
        .from('leads')
        .update(update)
        .eq('id', existing.id)
        .select(LEAD_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await this.supabase.admin
      .from('leads')
      .insert({
        organization_id: orgId,
        conversation_id: input.conversationId ?? null,
        name: input.name ?? null,
        phone,
        email,
        provider: input.provider ?? null,
        source: input.source ?? null,
        source_detail: input.sourceDetail ?? null,
        campaign: input.campaign ?? null,
        external_id: externalId,
        status: 'new',
        consent_optin: input.consentOptin ?? false,
        first_message: input.firstMessage ?? null,
        fields: input.fields ?? {},
        raw: input.raw ?? {},
      })
      .select(LEAD_COLUMNS)
      .single();
    if (error) throw error;
    this.logger.log(`Nuevo lead en CRM (org ${orgId}, source=${input.source ?? 'n/d'})`);
    return data;
  }

  /** Enlaza un lead con su conversación (si aún no lo estaba). */
  async linkConversation(orgId: string, leadId: string, conversationId: string) {
    await this.supabase.admin
      .from('leads')
      .update({ conversation_id: conversationId })
      .eq('id', leadId)
      .eq('organization_id', orgId)
      .is('conversation_id', null);
  }

  /** Mantiene el estado del lead sincronizado con el de su conversación. */
  async syncStatusByConversation(orgId: string, conversationId: string, status: string) {
    await this.supabase.admin
      .from('leads')
      .update({ status })
      .eq('organization_id', orgId)
      .eq('conversation_id', conversationId);
  }

  // --- CRM (autenticado) ------------------------------------------------------

  async list(
    orgId: string,
    filters: { status?: string; source?: string; search?: string; tagId?: string } = {},
  ) {
    // Filtro por etiqueta: las etiquetas viven en la conversación, así que primero
    // resolvemos qué conversaciones tienen esa etiqueta y filtramos los leads por
    // su conversation_id.
    let convIdsForTag: string[] | null = null;
    if (filters.tagId) {
      const { data: tagged } = await this.supabase.admin
        .from('conversation_tags')
        .select('conversation_id')
        .eq('organization_id', orgId)
        .eq('tag_id', filters.tagId);
      convIdsForTag = [...new Set((tagged ?? []).map((r) => r.conversation_id as string))];
      if (convIdsForTag.length === 0) return [];
    }

    let query = this.supabase.admin
      .from('leads')
      .select(
        'id, conversation_id, name, phone, email, provider, source, source_detail, campaign, status, created_at',
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.source) query = query.eq('source', filters.source);
    if (convIdsForTag) query = query.in('conversation_id', convIdsForTag);
    if (filters.search) {
      // Escapamos los caracteres reservados de la gramática de filtros de
      // PostgREST (`,`, `%`, `(`, `)`, `.`, `"`, `*`, `\`) para que el término de
      // búsqueda no pueda alterar la consulta `.or()` (inyección de filtro).
      const s = filters.search.replace(/[%,()."\\*]/g, ' ').trim();
      if (s) {
        query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    const leads = data ?? [];
    return this.attachTags(orgId, leads);
  }

  /** Adjunta a cada lead sus etiquetas (vía su conversación), en 2 consultas. */
  private async attachTags<T extends { conversation_id?: string | null }>(
    orgId: string,
    leads: T[],
  ): Promise<Array<T & { tags: Array<{ tag_id: string; name: string; color: string }> }>> {
    const convIds = leads.map((l) => l.conversation_id).filter(Boolean) as string[];
    if (convIds.length === 0) return leads.map((l) => ({ ...l, tags: [] }));

    const { data: applied } = await this.supabase.admin
      .from('conversation_tags')
      .select('conversation_id, tag_id')
      .eq('organization_id', orgId)
      .in('conversation_id', convIds);
    const rows = applied ?? [];
    if (rows.length === 0) return leads.map((l) => ({ ...l, tags: [] }));

    const tagIds = [...new Set(rows.map((r) => r.tag_id as string))];
    const { data: defs } = await this.supabase.admin
      .from('tag_definitions')
      .select('id, name, color')
      .in('id', tagIds);
    const byId = new Map((defs ?? []).map((d) => [d.id as string, d]));

    const byConv = new Map<string, Array<{ tag_id: string; name: string; color: string }>>();
    for (const r of rows) {
      const def = byId.get(r.tag_id as string);
      if (!def) continue;
      const arr = byConv.get(r.conversation_id as string) ?? [];
      arr.push({ tag_id: r.tag_id as string, name: def.name as string, color: def.color as string });
      byConv.set(r.conversation_id as string, arr);
    }
    return leads.map((l) => ({
      ...l,
      tags: (l.conversation_id ? byConv.get(l.conversation_id) : undefined) ?? [],
    }));
  }

  /** Alta manual de un lead desde el CRM (deduplica igual que el intake). */
  async create(orgId: string, input: RecordLeadInput) {
    return this.record(orgId, { ...input, source: input.source ?? 'manual' });
  }

  /**
   * Alta masiva desde un CSV. Devuelve un resumen. Deduplica por
   * external_id/teléfono/email (reutiliza `record`).
   */
  async importCsv(orgId: string, csvText: string) {
    const rows = parseCsv(csvText);
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const mapped = mapCsvRow(row);
      if (!mapped.name && !mapped.phone && !mapped.email) {
        skipped++;
        continue;
      }
      try {
        await this.record(orgId, {
          name: mapped.name,
          phone: mapped.phone,
          email: mapped.email,
          source: mapped.source ?? 'csv',
          sourceDetail: mapped.source_detail,
          campaign: mapped.campaign,
          consentOptin: true,
          fields: mapped.fields,
          raw: row,
        });
        imported++;
      } catch (err) {
        skipped++;
        if (errors.length < 5) errors.push(String(err));
      }
    }
    return { total: rows.length, imported, skipped, errors };
  }

  /** Elimina un lead del CRM. La conversación (si la hay) NO se toca. */
  async remove(orgId: string, id: string) {
    const { error } = await this.supabase.admin
      .from('leads')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw error;
    return { ok: true };
  }

  async get(orgId: string, id: string) {
    const { data: lead } = await this.supabase.admin
      .from('leads')
      .select(LEAD_COLUMNS)
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!lead) throw new NotFoundException('Lead no encontrado');

    let conversation: unknown = null;
    if (lead.conversation_id) {
      const { data: conv } = await this.supabase.admin
        .from('conversations')
        .select('id, provider, contact_name, contact_handle, stage, mode, ai_enabled, last_message_at')
        .eq('id', lead.conversation_id)
        .eq('organization_id', orgId)
        .maybeSingle();
      conversation = conv ?? null;
    }
    return { lead, conversation };
  }

  async update(orgId: string, id: string, patch: LeadPatch) {
    const update: Record<string, unknown> = {};
    if (patch.status) update.status = patch.status;
    if (typeof patch.notes === 'string') update.notes = patch.notes;
    if (typeof patch.name === 'string') update.name = patch.name;
    if (typeof patch.email === 'string') update.email = normalizeEmail(patch.email);

    const { data, error } = await this.supabase.admin
      .from('leads')
      .update(update)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select(LEAD_COLUMNS)
      .single();
    if (error) throw error;

    // Si cambiamos el estado y hay conversación, la mantenemos alineada.
    if (patch.status && data?.conversation_id) {
      await this.supabase.admin
        .from('conversations')
        .update({ stage: patch.status })
        .eq('id', data.conversation_id)
        .eq('organization_id', orgId);
    }
    return data;
  }

  /** Métricas rápidas para las tarjetas del CRM. */
  async stats(orgId: string) {
    const { data } = await this.supabase.admin
      .from('leads')
      .select('status, source')
      .eq('organization_id', orgId)
      .limit(5000);
    const rows = data ?? [];
    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const r of rows) {
      const st = (r.status as string) || 'new';
      const sc = (r.source as string) || 'otro';
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      bySource[sc] = (bySource[sc] ?? 0) + 1;
    }
    return { total: rows.length, byStatus, bySource };
  }

  // ---------------------------------------------------------------------------

  private async findExisting(
    orgId: string,
    externalId: string | null,
    phone: string | null,
    email: string | null,
  ) {
    const pick = async (col: string, val: string) => {
      const { data } = await this.supabase.admin
        .from('leads')
        .select(LEAD_COLUMNS)
        .eq('organization_id', orgId)
        .eq(col, val)
        .maybeSingle();
      return data;
    };
    if (externalId) {
      const found = await pick('external_id', externalId);
      if (found) return found;
    }
    if (phone) {
      const found = await pick('phone', phone);
      if (found) return found;
    }
    if (email) {
      const found = await pick('email', email);
      if (found) return found;
    }
    return null;
  }
}

function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 ? `+${digits}` : null;
}

function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/**
 * Parser CSV mínimo pero correcto: soporta comillas dobles, separador coma o
 * punto y coma (autodetectado), y saltos de línea dentro de campos entrecomillados.
 * Devuelve un array de objetos { cabecera: valor }.
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!clean.trim()) return [];

  // Autodetección de separador en la primera línea (fuera de comillas).
  const firstLine = clean.split('\n')[0] ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  const sep = semis > commas ? ';' : ',';

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      record.push(field);
      field = '';
    } else if (c === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) return [];
  const headers = records[0].map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < records.length; r++) {
    const row = records[r];
    if (row.length === 1 && row[0].trim() === '') continue; // línea vacía
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (row[idx] ?? '').trim();
    });
    out.push(obj);
  }
  return out;
}

/** Mapea las cabeceras del CSV (en varios idiomas) a los campos del lead. */
function mapCsvRow(row: Record<string, string>): {
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
  source_detail?: string;
  campaign?: string;
  fields: Record<string, string>;
} {
  const KNOWN: Record<string, 'name' | 'phone' | 'email' | 'source' | 'source_detail' | 'campaign'> = {
    name: 'name',
    nombre: 'name',
    'full name': 'name',
    'nombre completo': 'name',
    phone: 'phone',
    telefono: 'phone',
    teléfono: 'phone',
    movil: 'phone',
    móvil: 'phone',
    whatsapp: 'phone',
    email: 'email',
    correo: 'email',
    'e-mail': 'email',
    source: 'source',
    fuente: 'source',
    origen: 'source',
    campaign: 'campaign',
    campaña: 'campaign',
    campana: 'campaign',
    detail: 'source_detail',
    detalle: 'source_detail',
  };
  const result: {
    name?: string;
    phone?: string;
    email?: string;
    source?: string;
    source_detail?: string;
    campaign?: string;
    fields: Record<string, string>;
  } = { fields: {} };
  for (const [key, value] of Object.entries(row)) {
    if (!value) continue;
    const norm = key.trim().toLowerCase();
    const target = KNOWN[norm];
    if (target) {
      result[target] = value;
    } else if (key.trim()) {
      result.fields[key.trim()] = value;
    }
  }
  return result;
}
