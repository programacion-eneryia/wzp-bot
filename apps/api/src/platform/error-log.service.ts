import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type ErrorLogInput = {
  level?: 'error' | 'warn';
  source?: string;
  message: string;
  detail?: Record<string, unknown> | null;
  organizationId?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  statusCode?: number | null;
};

export type ErrorLogRow = {
  id: string;
  organization_id: string | null;
  level: string;
  source: string | null;
  message: string;
  detail: Record<string, unknown> | null;
  request_method: string | null;
  request_path: string | null;
  status_code: number | null;
  created_at: string;
};

/**
 * Persiste errores del sistema en `error_logs` para que el super-admin pueda
 * diagnosticarlos desde el panel. Nunca lanza: si el guardado falla, solo lo
 * registra en consola (no queremos que el logging tape el error original).
 */
@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async log(input: ErrorLogInput): Promise<void> {
    try {
      await this.supabase.admin.from('error_logs').insert({
        level: input.level ?? 'error',
        source: input.source ?? null,
        message: input.message.slice(0, 4000),
        detail: input.detail ?? null,
        organization_id: input.organizationId ?? null,
        request_method: input.requestMethod ?? null,
        request_path: input.requestPath ?? null,
        status_code: input.statusCode ?? null,
      });
    } catch (err) {
      this.logger.warn(`No se pudo guardar error_log: ${String(err)}`);
    }
  }

  async list(params: { limit?: number; organizationId?: string } = {}): Promise<ErrorLogRow[]> {
    let q = this.supabase.admin
      .from('error_logs')
      .select(
        'id, organization_id, level, source, message, detail, request_method, request_path, status_code, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(Math.min(params.limit ?? 200, 500));
    if (params.organizationId) q = q.eq('organization_id', params.organizationId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as ErrorLogRow[];
  }

  async clear(): Promise<{ ok: true }> {
    // Borra todo el histórico (neq a un uuid imposible = todas las filas).
    await this.supabase.admin
      .from('error_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    return { ok: true };
  }
}
