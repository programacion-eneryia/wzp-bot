import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { isAllowedModel } from '../setter/model-options';
import {
  AGENT_TEMPLATES,
  BEHAVIOR_KEYS,
  type Agent,
  type AgentBehavior,
  type AgentInput,
  type AgentKind,
  type AgentWithChannels,
  type InitialAssignment,
} from './agents.types';

const EDITABLE: (keyof AgentInput)[] = [
  'name',
  'kind',
  'is_active',
  'uses_stages',
  'persona_name',
  'identity_role',
  'objective',
  'tone',
  'rules',
  'instructions',
  'qualification_criteria',
  'funnel_phases',
  'conversation_types',
  'special_cases',
  'followups',
  'best_practices',
  'winning_examples',
  'calendar_mode',
  'calendar_link',
  'call_duration_min',
  'default_calendar_id',
  'model',
  'sort_order',
  'pipeline_id',
  'is_default_lead',
  'is_default_conversation',
  'behavior',
];

/** Cache corto por instancia: el agente se resuelve en cada mensaje. */
const CACHE_TTL_MS = 20_000;

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private readonly cache = new Map<string, { at: number; agents: Agent[] }>();

  constructor(private readonly supabase: SupabaseService) {}

  // ---------------------------------------------------------------------------
  //  Lectura
  // ---------------------------------------------------------------------------

  /** Todos los agentes de la org (crea Setter + Soporte si no hay ninguno). */
  async list(orgId: string): Promise<Agent[]> {
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.agents;

    let agents = await this.fetchAll(orgId);
    if (agents.length === 0) {
      await this.seedDefaults(orgId);
      agents = await this.fetchAll(orgId);
    }
    this.cache.set(orgId, { at: Date.now(), agents });
    return agents;
  }

  async listWithChannels(orgId: string): Promise<AgentWithChannels[]> {
    const agents = await this.list(orgId);
    const { data: channels } = await this.supabase.admin
      .from('channels')
      .select('id, provider, display_name, agent_id')
      .eq('organization_id', orgId);
    return agents.map((a) => ({
      ...a,
      channels: (channels ?? [])
        .filter((c) => c.agent_id === a.id)
        .map((c) => ({
          id: c.id as string,
          provider: c.provider as string,
          display_name: (c.display_name as string | null) ?? null,
        })),
    }));
  }

  async get(orgId: string, id: string): Promise<Agent> {
    const agents = await this.list(orgId);
    const found = agents.find((a) => a.id === id);
    if (found) return found;
    const { data } = await this.supabase.admin
      .from('agents')
      .select('*')
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Agente no encontrado');
    return data as Agent;
  }

  /** Primer agente activo de un tipo (por orden). */
  async firstOfKind(orgId: string, kind: AgentKind): Promise<Agent | null> {
    const agents = await this.list(orgId);
    return agents.find((a) => a.kind === kind && a.is_active) ?? null;
  }

  /**
   * El agente de ese tipo que ya tiene la cuenta, para actualizarlo en vez de
   * crear otro: primero el predeterminado, luego cualquier activo y, si no,
   * uno inactivo (desactivarlo no debe provocar un duplicado).
   */
  async existingOfKind(orgId: string, kind: AgentKind): Promise<Agent | null> {
    const ofKind = (await this.list(orgId)).filter((a) => a.kind === kind);
    return (
      ofKind.find((a) => a.is_active && (a.is_default_lead || a.is_default_conversation)) ??
      ofKind.find((a) => a.is_active) ??
      ofKind[0] ??
      null
    );
  }

  /**
   * Resuelve QUÉ agente atiende una conversación:
   *   1. override de la conversación (`conversations.agent_id`)
   *   2. modo soporte confirmado por un humano → agente de soporte
   *   3. agente por defecto del canal (`channels.agent_id`)
   *   4. agente predeterminado para conversaciones nuevas
   *   5. primer agente setter activo / cualquier agente activo
   */
  async resolveForConversation(
    orgId: string,
    conv: { agent_id?: string | null; channel_id?: string | null; mode?: string | null },
  ): Promise<Agent | null> {
    const agents = await this.list(orgId);
    const active = agents.filter((a) => a.is_active);
    if (active.length === 0) return null;

    if (conv.agent_id) {
      const a = active.find((x) => x.id === conv.agent_id);
      if (a) return a;
    }
    if (conv.mode === 'support') {
      const s = active.find((x) => x.kind === 'support');
      if (s) return s;
    }
    if (conv.channel_id) {
      const { data: ch } = await this.supabase.admin
        .from('channels')
        .select('agent_id')
        .eq('id', conv.channel_id)
        .maybeSingle();
      const a = ch?.agent_id ? active.find((x) => x.id === ch.agent_id) : null;
      if (a) return a;
    }
    return (
      active.find((x) => x.is_default_conversation) ??
      active.find((x) => x.kind === 'setter') ??
      active[0]
    );
  }

  /** Agente activo por id o por nombre (sin distinguir mayúsculas). */
  async findActiveByRef(orgId: string, ref: string | null | undefined): Promise<Agent | null> {
    const r = (ref ?? '').trim();
    if (!r) return null;
    const active = (await this.list(orgId)).filter((a) => a.is_active);
    return (
      active.find((a) => a.id === r) ??
      active.find((a) => a.name.trim().toLowerCase() === r.toLowerCase()) ??
      null
    );
  }

  /**
   * Arranque de una conversación nueva que llega por un canal: la IA solo se
   * enciende si hay un agente predeterminado para conversaciones nuevas. Si el
   * canal tiene un agente asignado, atiende ese (es más específico).
   * No fija `agent_id`: se resuelve en cada mensaje (canal → predeterminado).
   */
  async initialForConversation(orgId: string, channelId: string | null): Promise<InitialAssignment> {
    const active = (await this.list(orgId)).filter((a) => a.is_active);
    const def = active.find((a) => a.is_default_conversation) ?? null;
    if (!def) {
      return { agent: null, ai_enabled: false, stage: await this.firstStageOf(orgId, null), agent_id: null };
    }
    let agent = def;
    if (channelId) {
      const { data: ch } = await this.supabase.admin
        .from('channels')
        .select('agent_id')
        .eq('id', channelId)
        .maybeSingle();
      agent = (ch?.agent_id && active.find((a) => a.id === ch.agent_id)) || def;
    }
    return { agent, ai_enabled: true, stage: await this.firstStageOf(orgId, agent), agent_id: null };
  }

  /**
   * Arranque de un lead que entra por formulario/GHL/webhook: atiende el agente
   * indicado (id o nombre) o, si no, el predeterminado para leads. Sin ninguno,
   * el lead queda registrado con la IA pausada.
   */
  async initialForLead(orgId: string, agentRef?: string | null): Promise<InitialAssignment> {
    const active = (await this.list(orgId)).filter((a) => a.is_active);
    const agent =
      (await this.findActiveByRef(orgId, agentRef)) ??
      active.find((a) => a.is_default_lead) ??
      null;
    return {
      agent,
      ai_enabled: Boolean(agent),
      stage: await this.firstStageOf(orgId, agent),
      agent_id: agent?.id ?? null,
    };
  }

  /** Primera etapa del pipeline del agente (o del pipeline por defecto). */
  async firstStageOf(orgId: string, agent: Pick<Agent, 'pipeline_id'> | null): Promise<string> {
    let pipelineId = agent?.pipeline_id ?? null;
    if (!pipelineId) pipelineId = await this.pipelineIdByKey(orgId, null);
    if (!pipelineId) return 'new';
    const { data } = await this.supabase.admin
      .from('pipeline_stages')
      .select('key')
      .eq('organization_id', orgId)
      .eq('pipeline_id', pipelineId)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data?.key as string | undefined) ?? 'new';
  }

  // ---------------------------------------------------------------------------
  //  Escritura
  // ---------------------------------------------------------------------------

  async create(orgId: string, userId: string | null, input: AgentInput): Promise<Agent> {
    const kind: AgentKind = input.kind ?? 'setter';
    const base = AGENT_TEMPLATES[kind] ?? AGENT_TEMPLATES.custom;
    const agents = await this.list(orgId);
    const maxOrder = agents.reduce((m, a) => Math.max(m, a.sort_order), 0);

    const row: Record<string, unknown> = {
      ...base,
      ...this.clean(input),
      organization_id: orgId,
      created_by: userId,
      sort_order: input.sort_order ?? maxOrder + 10,
    };
    if (!row.name || !String(row.name).trim()) {
      throw new BadRequestException('El nombre del agente es obligatorio');
    }
    if (input.pipeline_id === undefined && row.uses_stages !== false) {
      row.pipeline_id = await this.pipelineIdByKey(orgId, kind === 'support' ? 'support' : null);
      row.uses_stages = Boolean(row.pipeline_id);
    }
    if (row.pipeline_id) await this.assertPipeline(orgId, row.pipeline_id as string);
    await this.releaseDefaults(orgId, null, row);

    const { data, error } = await this.supabase.admin
      .from('agents')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    this.cache.delete(orgId);
    return data as Agent;
  }

  async update(orgId: string, id: string, input: AgentInput): Promise<Agent> {
    const patch = this.clean(input);
    if (Object.keys(patch).length === 0) return this.get(orgId, id);
    if (patch.pipeline_id) await this.assertPipeline(orgId, patch.pipeline_id as string);
    await this.releaseDefaults(orgId, id, patch);

    const { data, error } = await this.supabase.admin
      .from('agents')
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Agente no encontrado');
    this.cache.delete(orgId);
    return data as Agent;
  }

  async duplicate(orgId: string, userId: string | null, id: string): Promise<Agent> {
    const src = await this.get(orgId, id);
    const { id: _id, organization_id: _o, created_at: _c, updated_at: _u, ...rest } = src;
    void _id;
    void _o;
    void _c;
    void _u;
    return this.create(orgId, userId, {
      ...rest,
      name: `${src.name} (copia)`,
      is_active: false,
      is_default_lead: false,
      is_default_conversation: false,
    });
  }

  async remove(orgId: string, id: string): Promise<{ ok: true }> {
    const agents = await this.list(orgId);
    const target = agents.find((a) => a.id === id);
    if (!target) throw new NotFoundException('Agente no encontrado');
    if (agents.length <= 1) {
      throw new BadRequestException('No puedes borrar el único agente de la cuenta');
    }
    const { error } = await this.supabase.admin
      .from('agents')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw error;
    this.cache.delete(orgId);
    return { ok: true };
  }

  /**
   * Asigna canales a un agente: los ids indicados pasan a usar este agente por
   * defecto; los que lo tenían y ya no están en la lista quedan sin agente
   * (caen al setter por defecto).
   */
  async assignChannels(orgId: string, agentId: string, channelIds: string[]): Promise<void> {
    await this.get(orgId, agentId);
    const { data: channels } = await this.supabase.admin
      .from('channels')
      .select('id, agent_id')
      .eq('organization_id', orgId);
    const wanted = new Set(channelIds);
    for (const ch of channels ?? []) {
      const id = ch.id as string;
      if (wanted.has(id) && ch.agent_id !== agentId) {
        await this.supabase.admin.from('channels').update({ agent_id: agentId }).eq('id', id);
      } else if (!wanted.has(id) && ch.agent_id === agentId) {
        await this.supabase.admin.from('channels').update({ agent_id: null }).eq('id', id);
      }
    }
  }

  /**
   * Cambia (o quita, con null) el agente de una conversación. Si la etapa
   * actual no pertenece al pipeline del nuevo agente, pasa a la primera etapa
   * de ese pipeline (un chat de soporte no se queda en "Cualificando").
   */
  async setConversationAgent(orgId: string, conversationId: string, agentId: string | null) {
    const agent = agentId ? await this.get(orgId, agentId) : null;
    const { data: conv } = await this.supabase.admin
      .from('conversations')
      .select('id, stage')
      .eq('id', conversationId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    const patch: Record<string, unknown> = { agent_id: agentId };
    const nextStage = agent ? await this.stageForAgent(orgId, agent, conv.stage as string | null) : null;
    if (nextStage && nextStage !== conv.stage) patch.stage = nextStage;
    await this.supabase.admin.from('conversations').update(patch).eq('id', conversationId);
    return { ok: true, stage: (patch.stage as string | undefined) ?? (conv.stage as string | null) };
  }

  /** Etapa que debe tener un chat al pasar a `agent` (null = no cambia). */
  async stageForAgent(orgId: string, agent: Agent, current: string | null): Promise<string | null> {
    if (!agent.pipeline_id) return null;
    if (current) {
      const { data } = await this.supabase.admin
        .from('pipeline_stages')
        .select('pipeline_id')
        .eq('organization_id', orgId)
        .eq('key', current)
        .maybeSingle();
      if (data?.pipeline_id === agent.pipeline_id) return null;
    }
    return this.firstStageOf(orgId, agent);
  }

  // ---------------------------------------------------------------------------
  //  Internos
  // ---------------------------------------------------------------------------

  private async fetchAll(orgId: string): Promise<Agent[]> {
    const { data, error } = await this.supabase.admin
      .from('agents')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Agent[];
  }

  /**
   * Org sin agentes (cuenta nueva o anterior a la migración): creamos Setter y
   * Soporte a partir de su setter_configs si existe, o de las plantillas.
   */
  private async seedDefaults(orgId: string): Promise<void> {
    const { data: cfg } = await this.supabase.admin
      .from('setter_configs')
      .select('*')
      .eq('organization_id', orgId)
      .maybeSingle();
    const c = (cfg ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined);

    const setter: AgentInput = {
      ...AGENT_TEMPLATES.setter,
      persona_name: str('setter_name') ?? AGENT_TEMPLATES.setter.persona_name,
      identity_role: str('identity_role') ?? AGENT_TEMPLATES.setter.identity_role,
      objective: str('objective') ?? AGENT_TEMPLATES.setter.objective,
      tone: str('tone') ?? AGENT_TEMPLATES.setter.tone,
      rules: str('rules') ?? null,
      qualification_criteria: str('qualification_criteria') ?? null,
      funnel_phases: str('funnel_phases') ?? null,
      conversation_types: str('conversation_types') ?? null,
      special_cases: str('special_cases') ?? null,
      followups: str('followups') ?? null,
      best_practices: str('best_practices') ?? null,
      winning_examples: str('winning_examples') ?? null,
      calendar_mode: (str('calendar_mode') as Agent['calendar_mode']) ?? 'off',
      calendar_link: str('calendar_link') ?? null,
      call_duration_min: typeof c.call_duration_min === 'number' ? (c.call_duration_min as number) : 30,
      default_calendar_id: str('default_calendar_id') ?? null,
      sort_order: 10,
    };
    const support: AgentInput = {
      ...AGENT_TEMPLATES.support,
      persona_name: setter.persona_name,
      identity_role: setter.identity_role,
      objective: str('support_objective') ?? AGENT_TEMPLATES.support.objective,
      tone: setter.tone,
      rules: setter.rules,
      instructions: str('support_instructions') ?? null,
      sort_order: 20,
    };

    const setterPipeline = await this.pipelineIdByKey(orgId, null);
    const supportPipeline = await this.pipelineIdByKey(orgId, 'support');
    const { data: created } = await this.supabase.admin
      .from('agents')
      .insert([
        {
          ...setter,
          organization_id: orgId,
          pipeline_id: setterPipeline,
          uses_stages: Boolean(setterPipeline),
          is_default_lead: true,
          is_default_conversation: true,
        },
        {
          ...support,
          organization_id: orgId,
          pipeline_id: supportPipeline,
          uses_stages: Boolean(supportPipeline),
        },
      ])
      .select('id, kind');
    const setterId = (created ?? []).find((a) => a.kind === 'setter')?.id as string | undefined;
    if (setterId) {
      await this.supabase.admin
        .from('channels')
        .update({ agent_id: setterId })
        .eq('organization_id', orgId)
        .is('agent_id', null);
    }
    this.logger.log(`Agentes por defecto creados para la org ${orgId}`);
  }

  /** Id del pipeline por clave ('support'…) o el por defecto (null). */
  private async pipelineIdByKey(orgId: string, key: string | null): Promise<string | null> {
    let q = this.supabase.admin.from('pipelines').select('id').eq('organization_id', orgId);
    q = key ? q.eq('key', key) : q.eq('is_default', true);
    const { data } = await q.limit(1).maybeSingle();
    if (data?.id) return data.id as string;
    if (key) return this.pipelineIdByKey(orgId, null);
    // Cuenta sin pipelines todavía: los sembramos.
    await this.supabase.admin.rpc('seed_default_stages', { p_org: orgId });
    const { data: again } = await this.supabase.admin
      .from('pipelines')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_default', true)
      .maybeSingle();
    return (again?.id as string | undefined) ?? null;
  }

  private async assertPipeline(orgId: string, pipelineId: string) {
    const { data } = await this.supabase.admin
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!data) throw new BadRequestException('Pipeline no encontrado');
  }

  /** Solo un agente por cuenta puede ser predeterminado de cada tipo. */
  private async releaseDefaults(orgId: string, exceptId: string | null, patch: Record<string, unknown>) {
    for (const col of ['is_default_lead', 'is_default_conversation'] as const) {
      if (patch[col] !== true) continue;
      let q = this.supabase.admin
        .from('agents')
        .update({ [col]: false })
        .eq('organization_id', orgId)
        .eq(col, true);
      if (exceptId) q = q.neq('id', exceptId);
      await q;
    }
  }

  /** Deja solo campos editables y sanea los delicados (modelo, agenda). */
  private clean(input: AgentInput): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      if (input[k] !== undefined) out[k] = input[k];
    }
    if ('model' in out) {
      const m = String(out.model ?? '').trim();
      out.model = m && isAllowedModel(m) ? m : null;
    }
    if ('calendar_mode' in out && !['off', 'slots', 'link'].includes(String(out.calendar_mode))) {
      out.calendar_mode = 'off';
    }
    if ('kind' in out && !['setter', 'support', 'custom'].includes(String(out.kind))) {
      delete out.kind;
    }
    if ('name' in out) out.name = String(out.name ?? '').trim();
    if ('call_duration_min' in out) {
      const n = Number(out.call_duration_min);
      out.call_duration_min = Number.isFinite(n) && n > 0 ? Math.min(240, Math.round(n)) : 30;
    }
    if ('default_calendar_id' in out && !out.default_calendar_id) out.default_calendar_id = null;
    if ('pipeline_id' in out) {
      out.pipeline_id = out.pipeline_id ? String(out.pipeline_id) : null;
      out.uses_stages = Boolean(out.pipeline_id);
    }
    if ('behavior' in out) out.behavior = cleanBehavior(out.behavior);
    return out;
  }
}

function cleanBehavior(raw: unknown): AgentBehavior | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const int = (v: unknown, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  for (const k of BEHAVIOR_KEYS) {
    const v = src[k];
    if (v === undefined || v === null || v === '') continue;
    switch (k) {
      case 'multi_bubble':
      case 'active_hours_enabled':
        out[k] = Boolean(v);
        break;
      case 'timezone':
        if (typeof v === 'string' && v.length <= 64) out[k] = v;
        break;
      case 'active_hours_start':
      case 'active_hours_end':
        out[k] = int(v, 0, 23);
        break;
      case 'first_reply_min_s':
      case 'first_reply_max_s':
        out[k] = int(v, 0, 3600);
        break;
      default:
        out[k] = int(v, 0, 60000);
    }
  }
  return Object.keys(out).length > 0 ? (out as AgentBehavior) : null;
}
