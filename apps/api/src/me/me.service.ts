import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export type OnboardingStep = {
  key: string;
  done: boolean;
  /** Dato auxiliar (p.ej. nº de canales conectados). */
  detail?: string | null;
};

export type OnboardingStatus = {
  completed_at: string | null;
  steps: OnboardingStep[];
};

export type DashboardPrefs = {
  /** Widgets visibles, en orden. */
  widgets: string[];
};

/**
 * Datos del usuario/organización que no encajan en otro módulo: onboarding
 * (estado por organización), preferencias del dashboard (por usuario) y perfil.
 */
@Injectable()
export class MeService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Estado del onboarding con comprobaciones automáticas por paso. */
  async onboardingStatus(orgId: string): Promise<OnboardingStatus> {
    const db = this.supabase.admin;
    const [org, channels, cfg, agents, tags, workflows, tests, real] = await Promise.all([
      db.from('organizations').select('onboarding_completed_at').eq('id', orgId).maybeSingle(),
      db.from('channels').select('id, status').eq('organization_id', orgId),
      db
        .from('setter_configs')
        .select('knowledge_base, company_name, offer')
        .eq('organization_id', orgId)
        .maybeSingle(),
      db.from('agents').select('id, is_active').eq('organization_id', orgId),
      db.from('tag_definitions').select('id').eq('organization_id', orgId).limit(1),
      db.from('workflows').select('id').eq('organization_id', orgId).limit(1),
      db
        .from('conversations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('is_test', true)
        .limit(1),
      db
        .from('conversations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('is_test', false)
        .not('last_outbound_at', 'is', null)
        .limit(1),
    ]);

    const connected = (channels.data ?? []).filter((c) => c.status === 'connected').length;
    const hasKnowledge = Boolean(
      (cfg.data?.knowledge_base ?? '').trim() ||
        ((cfg.data?.company_name ?? '').trim() && (cfg.data?.offer ?? '').trim()),
    );
    const activeAgents = (agents.data ?? []).filter((a) => a.is_active).length;

    return {
      completed_at: (org.data?.onboarding_completed_at as string | null) ?? null,
      steps: [
        {
          key: 'channel',
          done: connected > 0,
          detail: connected > 0 ? `${connected} canal(es) conectado(s)` : null,
        },
        { key: 'knowledge', done: hasKnowledge },
        {
          key: 'agents',
          done: activeAgents > 0,
          detail: activeAgents > 0 ? `${activeAgents} agente(s) activo(s)` : null,
        },
        { key: 'pipeline', done: (tags.data ?? []).length > 0 },
        { key: 'playground', done: (tests.data ?? []).length > 0 },
        { key: 'workflows', done: (workflows.data ?? []).length > 0 },
        { key: 'live', done: (real.data ?? []).length > 0 },
      ],
    };
  }

  async completeOnboarding(orgId: string): Promise<{ completed_at: string }> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.admin
      .from('organizations')
      .update({ onboarding_completed_at: now })
      .eq('id', orgId);
    if (error) throw error;
    return { completed_at: now };
  }

  async resetOnboarding(orgId: string): Promise<{ ok: true }> {
    const { error } = await this.supabase.admin
      .from('organizations')
      .update({ onboarding_completed_at: null })
      .eq('id', orgId);
    if (error) throw error;
    return { ok: true };
  }

  async getDashboardPrefs(userId: string): Promise<DashboardPrefs | null> {
    const { data } = await this.supabase.admin
      .from('profiles')
      .select('dashboard_prefs')
      .eq('id', userId)
      .maybeSingle();
    const prefs = data?.dashboard_prefs as DashboardPrefs | null | undefined;
    return prefs && Array.isArray(prefs.widgets) ? prefs : null;
  }

  async setDashboardPrefs(userId: string, prefs: DashboardPrefs): Promise<DashboardPrefs> {
    const clean: DashboardPrefs = {
      widgets: prefs.widgets.map((w) => String(w).slice(0, 40)).slice(0, 40),
    };
    const { error } = await this.supabase.admin
      .from('profiles')
      .update({ dashboard_prefs: clean })
      .eq('id', userId);
    if (error) throw error;
    return clean;
  }

  async getProfile(userId: string) {
    const { data } = await this.supabase.admin
      .from('profiles')
      .select('id, email, full_name, is_platform_admin, created_at')
      .eq('id', userId)
      .maybeSingle();
    return data;
  }

  async updateProfile(userId: string, patch: { full_name?: string | null }) {
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .update({ full_name: patch.full_name ?? null })
      .eq('id', userId)
      .select('id, email, full_name, is_platform_admin, created_at')
      .single();
    if (error) throw error;
    return data;
  }
}
