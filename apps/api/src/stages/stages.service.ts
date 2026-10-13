import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { WorkflowTriggerService } from '../workflows/workflow-trigger.service';
import {
  type Pipeline,
  type PipelineStage,
  type PipelineWithStages,
  SYSTEM_STAGE_KEYS,
} from './stages.types';

export type UpsertStageInput = {
  name?: string;
  color?: string;
  sort_order?: number;
};

/** Cache corto en memoria (por instancia serverless) para no releer el catálogo en cada mensaje. */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class StagesService {
  private readonly logger = new Logger(StagesService.name);
  private readonly cache = new Map<string, { at: number; stages: PipelineStage[] }>();
  private readonly pipelineCache = new Map<string, { at: number; pipelines: Pipeline[] }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly workflowTrigger: WorkflowTriggerService,
  ) {}

  /** Catálogo ordenado de la organización (siembra las de sistema si faltan). */
  async list(orgId: string): Promise<PipelineStage[]> {
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.stages;

    let { data } = await this.supabase.admin
      .from('pipeline_stages')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (!data || data.length === 0) {
      await this.supabase.admin.rpc('seed_default_stages', { p_org: orgId });
      ({ data } = await this.supabase.admin
        .from('pipeline_stages')
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: true }));
    }
    const stages = (data ?? []) as PipelineStage[];
    this.cache.set(orgId, { at: Date.now(), stages });
    return stages;
  }

  // ---------------------------------------------------------------------------
  //  Pipelines
  // ---------------------------------------------------------------------------

  async pipelines(orgId: string): Promise<Pipeline[]> {
    const hit = this.pipelineCache.get(orgId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.pipelines;
    let { data } = await this.supabase.admin
      .from('pipelines')
      .select('*')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (!data || data.length === 0) {
      await this.supabase.admin.rpc('seed_default_stages', { p_org: orgId });
      this.cache.delete(orgId);
      ({ data } = await this.supabase.admin
        .from('pipelines')
        .select('*')
        .eq('organization_id', orgId)
        .order('sort_order', { ascending: true }));
    }
    const pipelines = (data ?? []) as Pipeline[];
    this.pipelineCache.set(orgId, { at: Date.now(), pipelines });
    return pipelines;
  }

  /** Pipelines con sus etapas ordenadas (para el panel). */
  async pipelinesWithStages(orgId: string): Promise<PipelineWithStages[]> {
    const [pipelines, stages] = [await this.pipelines(orgId), await this.list(orgId)];
    return pipelines.map((p) => ({ ...p, stages: stages.filter((s) => s.pipeline_id === p.id) }));
  }

  async defaultPipeline(orgId: string): Promise<Pipeline | null> {
    const pipelines = await this.pipelines(orgId);
    return pipelines.find((p) => p.is_default) ?? pipelines[0] ?? null;
  }

  /** Pipeline al que pertenece una etapa (por key). */
  async pipelineOfStage(orgId: string, key: string | null): Promise<string | null> {
    if (!key) return null;
    const stage = (await this.list(orgId)).find((s) => s.key === key);
    return stage?.pipeline_id ?? null;
  }

  async createPipeline(orgId: string, name: string): Promise<PipelineWithStages> {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('El nombre es obligatorio');
    const pipelines = await this.pipelines(orgId);
    if (pipelines.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      throw new BadRequestException('Ya existe un pipeline con ese nombre');
    }
    const taken = new Set(pipelines.map((p) => p.key));
    let key = slugify(clean) || 'pipeline';
    for (let i = 2; taken.has(key); i++) key = `${slugify(clean) || 'pipeline'}_${i}`;
    const { data, error } = await this.supabase.admin
      .from('pipelines')
      .insert({
        organization_id: orgId,
        key,
        name: clean,
        sort_order: pipelines.reduce((m, p) => Math.max(m, p.sort_order), 0) + 10,
        is_default: false,
      })
      .select('*')
      .single();
    if (error) throw error;
    this.pipelineCache.delete(orgId);
    const pipeline = data as Pipeline;
    const stages: PipelineStage[] = [];
    const defaults: Array<[string, string]> = [
      ['Nuevo', '#64748b'],
      ['En curso', '#0ea5e9'],
      ['Cerrado', '#22c55e'],
    ];
    for (const [stageName, color] of defaults) {
      stages.push(await this.create(orgId, { name: stageName, color, pipeline_id: pipeline.id }));
    }
    return { ...pipeline, stages };
  }

  async renamePipeline(orgId: string, id: string, name: string): Promise<Pipeline> {
    const clean = name.trim();
    if (!clean) throw new BadRequestException('El nombre es obligatorio');
    const { data, error } = await this.supabase.admin
      .from('pipelines')
      .update({ name: clean })
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Pipeline no encontrado');
    this.pipelineCache.delete(orgId);
    return data as Pipeline;
  }

  /**
   * Borra un pipeline (no el por defecto). Sus chats pasan a la primera etapa
   * del pipeline por defecto y sus agentes pasan a usar ese pipeline.
   */
  async removePipeline(orgId: string, id: string): Promise<{ ok: true; moved: number }> {
    const pipelines = await this.pipelines(orgId);
    const target = pipelines.find((p) => p.id === id);
    if (!target) throw new NotFoundException('Pipeline no encontrado');
    if (target.is_default) {
      throw new BadRequestException('El pipeline principal no se puede borrar (sí renombrar)');
    }
    const def = await this.defaultPipeline(orgId);
    const stages = await this.list(orgId);
    const keys = stages.filter((s) => s.pipeline_id === id).map((s) => s.key);
    const fallback = stages.find((s) => s.pipeline_id === def?.id)?.key ?? 'new';

    let moved = 0;
    if (keys.length > 0) {
      const { data } = await this.supabase.admin
        .from('conversations')
        .update({ stage: fallback })
        .eq('organization_id', orgId)
        .in('stage', keys)
        .select('id');
      moved = data?.length ?? 0;
      await this.supabase.admin
        .from('leads')
        .update({ status: fallback })
        .eq('organization_id', orgId)
        .in('status', keys);
      await this.supabase.admin
        .from('tag_definitions')
        .update({ set_stage: null })
        .eq('organization_id', orgId)
        .in('set_stage', keys);
    }
    await this.supabase.admin
      .from('agents')
      .update({ pipeline_id: def?.id ?? null })
      .eq('organization_id', orgId)
      .eq('pipeline_id', id);
    const { error } = await this.supabase.admin
      .from('pipelines')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw error;
    this.pipelineCache.delete(orgId);
    this.cache.delete(orgId);
    return { ok: true, moved };
  }

  /** Mapa key → nombre visible (para prompts, variables y exportaciones). */
  async labelMap(orgId: string): Promise<Record<string, string>> {
    const stages = await this.list(orgId);
    return Object.fromEntries(stages.map((s) => [s.key, s.name]));
  }

  /** ¿Existe esta key en el pipeline de la organización? */
  async isValidKey(orgId: string, key: string): Promise<boolean> {
    const stages = await this.list(orgId);
    return stages.some((s) => s.key === key);
  }

  /** Lanza 400 si la key no pertenece al pipeline de la organización. */
  async assertValidKey(orgId: string, key: string): Promise<void> {
    if (!(await this.isValidKey(orgId, key))) {
      throw new BadRequestException(`Etapa desconocida: ${key}`);
    }
  }

  async create(
    orgId: string,
    input: { name: string; color?: string; pipeline_id?: string | null },
  ): Promise<PipelineStage> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    const pipelines = await this.pipelines(orgId);
    const pipelineId = input.pipeline_id ?? (await this.defaultPipeline(orgId))?.id ?? null;
    if (pipelineId && !pipelines.some((p) => p.id === pipelineId)) {
      throw new BadRequestException('Pipeline no encontrado');
    }
    const stages = await this.list(orgId);
    const siblings = stages.filter((s) => s.pipeline_id === pipelineId);
    if (siblings.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException('Ya existe una etapa con ese nombre en este pipeline');
    }
    const key = await this.uniqueKey(orgId, name, stages);
    const maxOrder = siblings.reduce((m, s) => Math.max(m, s.sort_order), 0);

    const { data, error } = await this.supabase.admin
      .from('pipeline_stages')
      .insert({
        organization_id: orgId,
        pipeline_id: pipelineId,
        key,
        name,
        color: input.color ?? '#6366f1',
        sort_order: maxOrder + 10,
        is_system: false,
      })
      .select('*')
      .single();
    if (error) throw error;
    this.cache.delete(orgId);
    return data as PipelineStage;
  }

  async update(orgId: string, id: string, input: UpsertStageInput): Promise<PipelineStage> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('El nombre es obligatorio');
      patch.name = name;
    }
    if (input.color !== undefined) patch.color = input.color;
    if (input.sort_order !== undefined) patch.sort_order = input.sort_order;

    const { data, error } = await this.supabase.admin
      .from('pipeline_stages')
      .update(patch)
      .eq('id', id)
      .eq('organization_id', orgId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Etapa no encontrada');
    this.cache.delete(orgId);
    return data as PipelineStage;
  }

  /** Reordena: recibe los ids en el orden deseado. */
  async reorder(orgId: string, ids: string[]): Promise<PipelineStage[]> {
    const stages = await this.list(orgId);
    const known = new Set(stages.map((s) => s.id));
    let order = 10;
    for (const id of ids) {
      if (!known.has(id)) continue;
      await this.supabase.admin
        .from('pipeline_stages')
        .update({ sort_order: order })
        .eq('id', id)
        .eq('organization_id', orgId);
      order += 10;
    }
    this.cache.delete(orgId);
    return this.list(orgId);
  }

  /**
   * Borra una etapa personalizada. Las conversaciones y leads que estaban en
   * ella pasan a `fallback` (por defecto 'new'). Las de sistema no se borran.
   */
  async remove(orgId: string, id: string, fallbackKey?: string): Promise<{ ok: true; moved: number }> {
    const stages = await this.list(orgId);
    const stage = stages.find((s) => s.id === id);
    if (!stage) throw new NotFoundException('Etapa no encontrada');
    if (stage.is_system) {
      throw new BadRequestException('Las etapas de sistema no se pueden borrar (sí renombrar)');
    }
    // Por defecto, la primera otra etapa del mismo pipeline.
    const fallback =
      fallbackKey ||
      stages.find((s) => s.pipeline_id === stage.pipeline_id && s.id !== id)?.key ||
      'new';
    if (!stages.some((s) => s.key === fallback) || fallback === stage.key) {
      throw new BadRequestException('Etapa de destino inválida');
    }

    const { data: moved } = await this.supabase.admin
      .from('conversations')
      .update({ stage: fallback })
      .eq('organization_id', orgId)
      .eq('stage', stage.key)
      .select('id');
    await this.supabase.admin
      .from('leads')
      .update({ status: fallback })
      .eq('organization_id', orgId)
      .eq('status', stage.key);
    await this.supabase.admin
      .from('tag_definitions')
      .update({ set_stage: null })
      .eq('organization_id', orgId)
      .eq('set_stage', stage.key);

    const { error } = await this.supabase.admin
      .from('pipeline_stages')
      .delete()
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) throw error;
    this.cache.delete(orgId);
    return { ok: true, moved: moved?.length ?? 0 };
  }

  /**
   * Cambia la etapa de una conversación (y de su lead) y dispara los workflows
   * con trigger "Al cambiar de estado". Punto único para que todo el código
   * (inbox, etiquetas, detector de citas, GHL…) se comporte igual.
   */
  async setConversationStage(
    orgId: string,
    conversationId: string,
    stage: string,
    opts: { extra?: Record<string, unknown>; skipIfIn?: string[] } = {},
  ): Promise<boolean> {
    if (!(await this.isValidKey(orgId, stage))) {
      this.logger.warn(`Etapa "${stage}" no existe en la org ${orgId}; no se aplica`);
      return false;
    }
    let q = this.supabase.admin
      .from('conversations')
      .update({ stage, ...(opts.extra ?? {}) })
      .eq('id', conversationId)
      .eq('organization_id', orgId);
    if (opts.skipIfIn && opts.skipIfIn.length > 0) {
      q = q.not('stage', 'in', `(${opts.skipIfIn.join(',')})`);
    }
    const { data } = await q.select('id');
    if (!data || data.length === 0) return false;

    await this.supabase.admin
      .from('leads')
      .update({ status: stage })
      .eq('organization_id', orgId)
      .eq('conversation_id', conversationId);
    void this.workflowTrigger.fire(orgId, conversationId, 'stage', { stage });
    return true;
  }

  /** Dispara los workflows "Al cambiar de estado" (para quien ya actualizó la etapa por su cuenta). */
  async fireStageWorkflows(orgId: string, conversationId: string, stage: string): Promise<void> {
    await this.workflowTrigger.fire(orgId, conversationId, 'stage', { stage });
  }

  /** Crea (si no existen) etapas a partir de nombres sugeridos por la IA. Devuelve las creadas. */
  async ensureByNames(orgId: string, names: string[]): Promise<PipelineStage[]> {
    const created: PipelineStage[] = [];
    const pipelineId = (await this.defaultPipeline(orgId))?.id ?? null;
    for (const raw of names) {
      const name = raw.trim();
      if (!name || name.length > 60) continue;
      const stages = (await this.list(orgId)).filter((s) => s.pipeline_id === pipelineId);
      if (stages.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
      try {
        created.push(await this.create(orgId, { name, pipeline_id: pipelineId }));
      } catch (err) {
        this.logger.warn(`No se pudo crear la etapa "${name}": ${String(err)}`);
      }
    }
    return created;
  }

  private async uniqueKey(orgId: string, name: string, stages: PipelineStage[]): Promise<string> {
    const base = slugify(name) || 'etapa';
    const taken = new Set<string>([...stages.map((s) => s.key), ...SYSTEM_STAGE_KEYS]);
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const k = `${base}_${i}`;
      if (!taken.has(k)) return k;
    }
    return `${base}_${Date.now()}`;
  }
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}
