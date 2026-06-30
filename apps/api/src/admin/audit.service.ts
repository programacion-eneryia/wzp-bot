import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type AuditEntry = {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Registra una acción de admin. Nunca lanza (la auditoría no debe romper el flujo). */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.supabase.admin.from('audit_logs').insert({
        actor_id: entry.actorId ?? null,
        actor_email: entry.actorEmail ?? null,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        organization_id: entry.organizationId ?? null,
        metadata: entry.metadata ?? {},
        ip: entry.ip ?? null,
      });
    } catch (err) {
      this.logger.warn(`No se pudo registrar auditoría (${entry.action}): ${String(err)}`);
    }
  }

  async list(params: { limit?: number; action?: string; organizationId?: string } = {}) {
    let query = this.supabase.admin
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(params.limit ?? 100, 500));
    if (params.action) query = query.eq('action', params.action);
    if (params.organizationId) query = query.eq('organization_id', params.organizationId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }
}
