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
  type Agent,
  type AgentInput,
  type AgentKind,
  type AgentWithChannels,
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
   * Resuelve QUÉ agente atiende una conversación:
   *   1. override de la conversación (`conversations.agent_id`)
   *   2. modo soporte confirmado por un humano → agente de soporte
   *   3. agente por defecto del canal (`channels.agent_id`)
   *   4. primer agente setter activo
   *   5. cualquier agente activo
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
    return active.find((x) => x.kind === 'setter') ?? active[0];
  }

  // ---------------------------------------------------------------------------
  //  Escritura
  // ---------------------------------------------------------------------------

  async create(orgId: string, userId: string | null, input: AgentInput): Promise<Agent> {
    const kind: AgentKind = input.kind ?? 'setter';
    const base = AGENT_TEMPLATES[kind] ?? AGENT_TEMPLATES.custom;
    const agents = await this.list(orgId);
    const maxOrder = agents.reduce((m, a) => Math.max(m, a.sort_order), 0);

    const row = {
      ...base,
      ...this.clean(input),
      organization_id: orgId,
      created_by: userId,
      sort_order: input.sort_order ?? maxOrder + 10,
    };
    if (!row.name || !String(row.name).trim()) {
      throw new BadRequestException('El nombre del agente es obligatorio');
    }

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

  /** Cambia (o quita, con null) el agente de una conversación concreta. */
  async setConversationAgent(orgId: string, conversationId: string, agentId: string | null) {
    if (agentId) await this.get(orgId, agentId);
    const { data } = await this.supabase.admin
      .from('conversations')
      .update({ agent_id: agentId })
      .eq('id', conversationId)
      .eq('organization_id', orgId)
      .select('id')
      .maybeSingle();
    if (!data) throw new NotFoundException('Conversación no encontrada');
    return { ok: true };
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

    const { data: created } = await this.supabase.admin
      .from('agents')
      .insert([
        { ...setter, organization_id: orgId },
        { ...support, organization_id: orgId },
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
    return out;
  }
}
