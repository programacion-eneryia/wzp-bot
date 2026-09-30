import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { WorkflowDefinition, WorkflowTrigger } from './workflows.types';

const COLS =
  'id, organization_id, name, trigger, trigger_config, is_active, resume_after_hours, agent_id, definition, created_at, updated_at';

export type WorkflowRow = {
  id: string;
  organization_id: string;
  name: string;
  trigger: WorkflowTrigger;
  trigger_config: Record<string, unknown>;
  is_active: boolean;
  resume_after_hours: number | null;
  /** Agente al que pertenece el workflow (null = cualquiera). */
  agent_id: string | null;
  definition: WorkflowDefinition;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class WorkflowsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string): Promise<WorkflowRow[]> {
    const { data, error } = await this.supabase.admin
      .from('workflows')
      .select(COLS)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as WorkflowRow[];
  }

  async get(orgId: string, id: string): Promise<WorkflowRow> {
    const { data, error } = await this.supabase.admin
      .from('workflows')
      .select(COLS)
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Workflow no encontrado');
    return data as WorkflowRow;
  }

  async create(
    orgId: string,
    userId: string,
    dto: {
      name: string;
      trigger?: WorkflowTrigger;
      trigger_config?: Record<string, unknown>;
      resume_after_hours?: number | null;
      agent_id?: string | null;
      definition?: WorkflowDefinition;
    },
  ): Promise<WorkflowRow> {
    const { data, error } = await this.supabase.admin
      .from('workflows')
      .insert({
        organization_id: orgId,
        name: dto.name,
        trigger: dto.trigger ?? 'lead_created',
        trigger_config: dto.trigger_config ?? {},
        resume_after_hours: dto.resume_after_hours ?? null,
        agent_id: dto.agent_id ?? null,
        definition: dto.definition ?? { nodes: [], edges: [] },
        created_by: userId,
      })
      .select(COLS)
      .single();
    if (error) throw error;
    return data as WorkflowRow;
  }

  async update(
    orgId: string,
    id: string,
    patch: {
      name?: string;
      trigger?: WorkflowTrigger;
      trigger_config?: Record<string, unknown>;
      is_active?: boolean;
      resume_after_hours?: number | null;
      agent_id?: string | null;
      definition?: WorkflowDefinition;
    },
  ): Promise<WorkflowRow> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.trigger !== undefined) update.trigger = patch.trigger;
    if (patch.trigger_config !== undefined) update.trigger_config = patch.trigger_config;
    if (patch.is_active !== undefined) update.is_active = patch.is_active;
    if (patch.resume_after_hours !== undefined) update.resume_after_hours = patch.resume_after_hours;
    if (patch.agent_id !== undefined) update.agent_id = patch.agent_id || null;
    if (patch.definition !== undefined) update.definition = patch.definition;

    const { data, error } = await this.supabase.admin
      .from('workflows')
      .update(update)
      .eq('organization_id', orgId)
      .eq('id', id)
      .select(COLS)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Workflow no encontrado');
    return data as WorkflowRow;
  }

  async remove(orgId: string, id: string): Promise<{ ok: true }> {
    const { error } = await this.supabase.admin
      .from('workflows')
      .delete()
      .eq('organization_id', orgId)
      .eq('id', id);
    if (error) throw error;
    return { ok: true };
  }

  /**
   * Workflow ACTIVO que debe arrancar para este trigger (o null).
   *
   * Con varios agentes puede haber un workflow por agente para el mismo
   * trigger: se elige el del agente que atiende la conversación (override de la
   * conversación → agente del canal), y si no hay uno específico, el genérico
   * (sin agente). Para el trigger "stage" además debe coincidir la etapa.
   */
  async findActiveByTrigger(
    orgId: string,
    trigger: WorkflowTrigger,
    opts: { stage?: string; conversationId?: string } = {},
  ): Promise<WorkflowRow | null> {
    const { data } = await this.supabase.admin
      .from('workflows')
      .select(COLS)
      .eq('organization_id', orgId)
      .eq('trigger', trigger)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    let candidates = ((data ?? []) as WorkflowRow[]).filter((wf) => {
      if (trigger !== 'stage') return true;
      const want = (wf.trigger_config?.stage as string | undefined) ?? null;
      return !want || !opts.stage || want === opts.stage;
    });
    if (candidates.length === 0) return null;

    const agentId = opts.conversationId
      ? await resolveConversationAgentId(this.supabase, opts.conversationId)
      : null;
    if (agentId) {
      const specific = candidates.find((wf) => wf.agent_id === agentId);
      if (specific) return specific;
    }
    candidates = candidates.filter((wf) => !wf.agent_id);
    return candidates[0] ?? null;
  }
}

/** Agente efectivo de una conversación: override propio → agente del canal. */
export async function resolveConversationAgentId(
  supabase: SupabaseService,
  conversationId: string,
): Promise<string | null> {
  const { data: conv } = await supabase.admin
    .from('conversations')
    .select('agent_id, channel_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return null;
  if (conv.agent_id) return conv.agent_id as string;
  if (!conv.channel_id) return null;
  const { data: ch } = await supabase.admin
    .from('channels')
    .select('agent_id')
    .eq('id', conv.channel_id as string)
    .maybeSingle();
  return (ch?.agent_id as string | null) ?? null;
}
