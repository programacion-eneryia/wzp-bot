import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { WorkflowTrigger } from './workflows.types';

/**
 * Arranque de workflows desde CUALQUIER módulo sin ciclos de dependencias.
 *
 * El motor (WorkflowEngineService) vive en WorkflowsModule, que importa
 * MessagingModule; por eso messaging/tags/inbox/ghl no pueden inyectar el motor
 * directamente. Este servicio solo depende de Supabase (global) y escribe
 * directamente en `workflow_runs`, igual que hace el motor al inscribir.
 */
@Injectable()
export class WorkflowTriggerService {
  private readonly logger = new Logger(WorkflowTriggerService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Inscribe la conversación en el workflow ACTIVO del trigger indicado.
   * Best-effort: nunca lanza. Devuelve true si se inició un run.
   */
  async fire(
    orgId: string,
    conversationId: string,
    trigger: WorkflowTrigger,
    opts: { stage?: string } = {},
  ): Promise<boolean> {
    try {
      const { data: wf } = await this.supabase.admin
        .from('workflows')
        .select('id, organization_id, definition, trigger_config, resume_after_hours')
        .eq('organization_id', orgId)
        .eq('trigger', trigger)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!wf) return false;

      // Trigger por estado: solo si coincide el configurado en el workflow.
      if (trigger === 'stage') {
        const want =
          ((wf.trigger_config as Record<string, unknown> | null)?.stage as string | undefined) ??
          null;
        if (want && opts.stage && want !== opts.stage) return false;
      }

      const def = (wf.definition ?? {}) as { nodes?: Array<{ id?: string; type?: string }> };
      const nodes = Array.isArray(def.nodes) ? def.nodes : [];
      const entry = nodes.find((n) => n.type === 'start') ?? nodes[0];
      if (!entry?.id) return false;

      const { error } = await this.supabase.admin.from('workflow_runs').insert({
        organization_id: orgId,
        workflow_id: wf.id,
        conversation_id: conversationId,
        status: 'active',
        current_node_id: entry.id,
        next_run_at: new Date().toISOString(),
        context: { resume_after_hours: wf.resume_after_hours ?? null },
      });
      if (error) {
        // 23505 = ya hay un run vivo para esta conv+workflow (índice único).
        if ((error as { code?: string }).code !== '23505') {
          this.logger.warn(`No se pudo iniciar workflow (${trigger}): ${error.message}`);
        }
        return false;
      }
      this.logger.log(
        `Workflow ${wf.id} iniciado por trigger "${trigger}" (conv ${conversationId})`,
      );
      return true;
    } catch (err) {
      this.logger.warn(`Trigger de workflow "${trigger}" falló: ${String(err)}`);
      return false;
    }
  }
}
