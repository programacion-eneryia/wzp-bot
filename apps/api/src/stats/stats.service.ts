import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StagesService } from '../stages/stages.service';
import { AgentsService } from '../agents/agents.service';

export type StatsFilters = {
  /** Solo conversaciones atendidas por este agente. */
  agentId?: string;
  /** Rango de fechas (ISO) por fecha de creación de la conversación. */
  from?: string;
  to?: string;
};

/**
 * Estadísticas agregadas por organización para el panel de "Estadísticas".
 *
 * "Leads" aquí son las CONVERSACIONES CON LAS QUE EL BOT HA HABLADO (al menos
 * un mensaje nuestro), no el total de contactos del CRM. Las conversaciones
 * atendidas por agentes sin pipeline (soporte) NO cuentan en el embudo.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly stages: StagesService,
    private readonly agents: AgentsService,
  ) {}

  async overview(orgId: string, filters: StatsFilters = {}) {
    const [funnel, crm, appointments, tags, messagesTotal, stageList] = await Promise.all([
      this.funnelStats(orgId, filters),
      this.crmStats(orgId),
      this.appointmentStats(orgId),
      this.tagStats(orgId),
      this.messagesTotal(orgId),
      this.stages.list(orgId),
    ]);

    const total = funnel.total;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    const by = funnel.byStage;
    const qualified =
      (by.qualified ?? 0) + (by.calendar_sent ?? 0) + (by.call_scheduled ?? 0) + (by.won ?? 0);
    const rates = {
      qualifiedPct: pct(qualified),
      calendarSentPct: pct((by.calendar_sent ?? 0) + (by.call_scheduled ?? 0) + (by.won ?? 0)),
      callScheduledPct: pct((by.call_scheduled ?? 0) + (by.won ?? 0)),
      wonPct: pct(by.won ?? 0),
      lostPct: pct((by.lost ?? 0) + (by.not_qualified ?? 0)),
    };

    return {
      // Compatibilidad con el front: `leads` = conversaciones con las que habló el bot.
      leads: {
        total,
        byStatus: funnel.byStage,
        bySource: funnel.bySource,
        last30: funnel.last30,
      },
      byChannel: funnel.byChannel,
      byAgent: funnel.byAgent,
      supportConversations: funnel.supportTotal,
      crm,
      conversations: { total, byStage: funnel.byStage },
      appointments,
      tags,
      messagesTotal,
      rates,
      stages: stageList.map((s) => ({ key: s.key, name: s.name, color: s.color })),
      agents: (await this.agents.list(orgId)).map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        uses_stages: a.uses_stages,
      })),
    };
  }

  /** Embudo: conversaciones con al menos un mensaje del bot, de agentes con pipeline. */
  private async funnelStats(orgId: string, filters: StatsFilters) {
    let q = this.supabase.admin
      .from('conversations')
      .select('id, stage, source, provider, created_at, agent_id, channel_id, mode')
      .eq('organization_id', orgId)
      .eq('is_test', false)
      .is('archived_at', null)
      .not('last_outbound_at', 'is', null)
      .limit(20000);
    if (filters.from) q = q.gte('created_at', filters.from);
    if (filters.to) q = q.lte('created_at', filters.to);
    const { data } = await q;
    const rows = data ?? [];

    // Agente efectivo por conversación (override → canal → setter por defecto).
    const agents = await this.agents.list(orgId);
    const agentById = new Map(agents.map((a) => [a.id, a]));
    const defaultAgent = agents.find((a) => a.kind === 'setter' && a.is_active) ?? agents[0] ?? null;
    const { data: channels } = await this.supabase.admin
      .from('channels')
      .select('id, agent_id')
      .eq('organization_id', orgId);
    const channelAgent = new Map((channels ?? []).map((c) => [c.id as string, c.agent_id as string | null]));
    const supportAgent = agents.find((a) => a.kind === 'support') ?? null;

    const byStage: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byChannel: Record<string, number> = {};
    const byAgent: Record<string, { name: string; count: number }> = {};
    const byDay = new Map<string, number>();
    let total = 0;
    let supportTotal = 0;

    for (const r of rows) {
      const explicit = r.agent_id ? agentById.get(r.agent_id as string) : undefined;
      const viaChannel = r.channel_id ? channelAgent.get(r.channel_id as string) : null;
      const agent =
        explicit ??
        (r.mode === 'support' && supportAgent ? supportAgent : undefined) ??
        (viaChannel ? agentById.get(viaChannel) : undefined) ??
        defaultAgent;

      if (filters.agentId && agent?.id !== filters.agentId) continue;
      if (agent && !agent.uses_stages) {
        supportTotal++;
        continue;
      }
      total++;
      const st = (r.stage as string) || 'new';
      byStage[st] = (byStage[st] ?? 0) + 1;
      const sc = (r.source as string) || (r.provider as string) || 'otro';
      bySource[sc] = (bySource[sc] ?? 0) + 1;
      const ch = (r.provider as string) || 'otro';
      byChannel[ch] = (byChannel[ch] ?? 0) + 1;
      if (agent) {
        const cur = byAgent[agent.id] ?? { name: agent.name, count: 0 };
        cur.count++;
        byAgent[agent.id] = cur;
      }
      const d = (r.created_at as string | null)?.slice(0, 10);
      if (d) byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }

    const last30: Array<{ date: string; count: number }> = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      last30.push({ date: key, count: byDay.get(key) ?? 0 });
    }

    return { total, byStage, bySource, byChannel, byAgent, last30, supportTotal };
  }

  /** Totales del CRM (todos los contactos, hablados o no). */
  private async crmStats(orgId: string) {
    const { data } = await this.supabase.admin
      .from('leads')
      .select('status, source')
      .eq('organization_id', orgId)
      .limit(20000);
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
