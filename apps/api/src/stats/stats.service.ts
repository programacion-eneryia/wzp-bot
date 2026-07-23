import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Estadísticas agregadas por organización para el panel de "Estadísticas":
 * leads (por estado/fuente y evolución), conversaciones (por etapa), citas,
 * etiquetas y ratios de conversión.
 */
@Injectable()
export class StatsService {
  constructor(private readonly supabase: SupabaseService) {}

  async overview(orgId: string) {
    const [leads, conversations, appointments, tags, messagesTotal] = await Promise.all([
      this.leadStats(orgId),
      this.conversationStats(orgId),
      this.appointmentStats(orgId),
      this.tagStats(orgId),
      this.messagesTotal(orgId),
    ]);

    const total = leads.total || 0;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    const qualified =
      (leads.byStatus.qualified ?? 0) +
      (leads.byStatus.call_scheduled ?? 0) +
      (leads.byStatus.won ?? 0);
    const rates = {
      qualifiedPct: pct(qualified),
      callScheduledPct: pct(
        (leads.byStatus.call_scheduled ?? 0) + (leads.byStatus.won ?? 0),
      ),
      wonPct: pct(leads.byStatus.won ?? 0),
      lostPct: pct((leads.byStatus.lost ?? 0) + (leads.byStatus.not_qualified ?? 0)),
    };

    return { leads, conversations, appointments, tags, messagesTotal, rates };
  }

  private async leadStats(orgId: string) {
    const { data } = await this.supabase.admin
      .from('leads')
      .select('status, source, created_at')
      .eq('organization_id', orgId)
      .limit(10000);
    const rows = data ?? [];
    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    // Evolución últimos 30 días (por día).
    const last30: Array<{ date: string; count: number }> = [];
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const st = (r.status as string) || 'new';
      const sc = (r.source as string) || 'otro';
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      bySource[sc] = (bySource[sc] ?? 0) + 1;
      const d = (r.created_at as string | null)?.slice(0, 10);
      if (d) byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      last30.push({ date: key, count: byDay.get(key) ?? 0 });
    }

    return { total: rows.length, byStatus, bySource, last30 };
  }

  private async conversationStats(orgId: string) {
    const { data } = await this.supabase.admin
      .from('conversations')
      .select('stage')
      .eq('organization_id', orgId)
      .eq('is_test', false)
      .is('archived_at', null)
      .limit(10000);
    const rows = data ?? [];
    const byStage: Record<string, number> = {};
    for (const r of rows) {
      const st = (r.stage as string) || 'new';
      byStage[st] = (byStage[st] ?? 0) + 1;
    }
    return { total: rows.length, byStage };
  }

  private async appointmentStats(orgId: string) {
    const { data } = await this.supabase.admin
      .from('appointments')
      .select('status, start_at, detected_by')
      .eq('organization_id', orgId)
      .limit(10000);
    const rows = data ?? [];
    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let upcoming = 0;
    const now = Date.now();
    for (const r of rows) {
      const st = (r.status as string) || 'scheduled';
      byStatus[st] = (byStatus[st] ?? 0) + 1;
      const src = (r.detected_by as string) || 'bot';
      bySource[src] = (bySource[src] ?? 0) + 1;
      const start = r.start_at ? new Date(r.start_at as string).getTime() : 0;
      if (st === 'scheduled' && start > now) upcoming++;
    }
    return { total: rows.length, byStatus, bySource, upcoming };
  }

  private async tagStats(orgId: string) {
    const { data: defs } = await this.supabase.admin
      .from('tag_definitions')
      .select('id, name, color, sort_order')
      .eq('organization_id', orgId)
      .order('sort_order', { ascending: true });
    const definitions = defs ?? [];
    if (definitions.length === 0) return [] as Array<{ id: string; name: string; color: string; count: number }>;

    const { data: applied } = await this.supabase.admin
      .from('conversation_tags')
      .select('tag_id')
      .eq('organization_id', orgId)
      .limit(20000);
    const counts = new Map<string, number>();
    for (const r of applied ?? []) {
      const id = r.tag_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return definitions.map((d) => ({
      id: d.id as string,
      name: d.name as string,
      color: d.color as string,
      count: counts.get(d.id as string) ?? 0,
    }));
  }

  private async messagesTotal(orgId: string) {
    const { count } = await this.supabase.admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    return count ?? 0;
  }
}
