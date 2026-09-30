import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AgentsService } from '../agents/agents.service';
import type { Agent, AgentInput } from '../agents/agents.types';
import { StagesService } from '../stages/stages.service';
import { SetterConfigService } from './setter-config.service';
import { BUSINESS_FIELDS, type GeneratedBrief } from './setter-assistant.service';
import type { GeneratedSetterFields, SetterConfig } from './setter-config.types';

export type BriefApplyResult = {
  config: SetterConfig;
  setter: Agent;
  support: Agent;
  created_tags: string[];
  created_stages: string[];
};

/**
 * Aplica lo generado a partir del brief:
 *   - Base de Conocimiento (setter_configs): campos de negocio + brief íntegro.
 *   - Agente SETTER: personalidad/objetivo/criterios (se crea si no existe).
 *   - Agente SOPORTE: objetivo/instrucciones (se crea si no existe).
 *   - Etiquetas sugeridas que no existan aún (auto-aplicables por la IA).
 *   - Etapas sugeridas que no existan aún.
 */
@Injectable()
export class BriefApplyService {
  private readonly logger = new Logger(BriefApplyService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly setterConfig: SetterConfigService,
    private readonly agents: AgentsService,
    private readonly stages: StagesService,
  ) {}

  async apply(
    orgId: string,
    userId: string | null,
    gen: GeneratedBrief,
    brief: string,
  ): Promise<BriefApplyResult> {
    // 1) Base de Conocimiento.
    const business: Partial<SetterConfig> = { knowledge_base: brief.slice(0, 28000) };
    for (const k of BUSINESS_FIELDS) {
      const v = gen.fields[k];
      if (v) (business as Record<string, unknown>)[k] = v;
    }
    const config = await this.setterConfig.update(orgId, business);

    // 2) Agente Setter.
    const setterPatch = setterAgentPatch(gen.fields);
    let setter = await this.agents.firstOfKind(orgId, 'setter');
    setter = setter
      ? await this.agents.update(orgId, setter.id, setterPatch)
      : await this.agents.create(orgId, userId, { ...setterPatch, kind: 'setter', name: 'Setter' });

    // 3) Agente Soporte (hereda persona, tono y reglas del setter).
    const supportPatch: AgentInput = {
      persona_name: setter.persona_name,
      identity_role: setter.identity_role,
      tone: setter.tone,
      rules: setter.rules,
    };
    if (gen.support.objective) supportPatch.objective = gen.support.objective;
    if (gen.support.instructions) supportPatch.instructions = gen.support.instructions;
    let support = await this.agents.firstOfKind(orgId, 'support');
    support = support
      ? await this.agents.update(orgId, support.id, supportPatch)
      : await this.agents.create(orgId, userId, {
          ...supportPatch,
          kind: 'support',
          name: 'Soporte',
          uses_stages: false,
        });

    // 4) Etiquetas sugeridas (solo las que no existan).
    const created_tags = await this.ensureTags(orgId, userId, gen.suggested_tags);

    // 5) Etapas sugeridas.
    const created_stages = (await this.stages.ensureByNames(orgId, gen.suggested_stages)).map(
      (s) => s.name,
    );

    return { config, setter, support, created_tags, created_stages };
  }

  private async ensureTags(
    orgId: string,
    userId: string | null,
    tags: Array<{ name: string; description: string }>,
  ): Promise<string[]> {
    if (tags.length === 0) return [];
    const { data: existing } = await this.supabase.admin
      .from('tag_definitions')
      .select('name')
      .eq('organization_id', orgId);
    const have = new Set((existing ?? []).map((t) => String(t.name).toLowerCase()));
    const created: string[] = [];
    for (const t of tags) {
      if (have.has(t.name.toLowerCase())) continue;
      const { error } = await this.supabase.admin.from('tag_definitions').insert({
        organization_id: orgId,
        name: t.name,
        description: t.description || null,
        color: pickColor(created.length),
        ai_enabled: true,
        created_by: userId,
      });
      if (error) {
        this.logger.warn(`No se pudo crear la etiqueta "${t.name}": ${error.message}`);
        continue;
      }
      have.add(t.name.toLowerCase());
      created.push(t.name);
    }
    return created;
  }
}

/** Traduce los campos generados a la forma del agente (setter_name → persona_name). */
function setterAgentPatch(f: GeneratedSetterFields): AgentInput {
  const p: AgentInput = {};
  if (f.setter_name) p.persona_name = f.setter_name;
  if (f.identity_role) p.identity_role = f.identity_role;
  if (f.objective) p.objective = f.objective;
  if (f.tone) p.tone = f.tone;
  if (f.rules) p.rules = f.rules;
  if (f.qualification_criteria) p.qualification_criteria = f.qualification_criteria;
  if (f.funnel_phases) p.funnel_phases = f.funnel_phases;
  if (f.conversation_types) p.conversation_types = f.conversation_types;
  if (f.special_cases) p.special_cases = f.special_cases;
  if (f.followups) p.followups = f.followups;
  if (f.best_practices) p.best_practices = f.best_practices;
  return p;
}

const PALETTE = ['#6366f1', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#f97316'];
function pickColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}
