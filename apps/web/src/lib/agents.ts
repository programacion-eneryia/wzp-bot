"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type AgentKind = "setter" | "support" | "custom";

export type Agent = {
  id: string;
  organization_id: string;
  name: string;
  kind: AgentKind;
  is_active: boolean;
  uses_stages: boolean;
  persona_name: string;
  identity_role: string;
  objective: string;
  tone: string;
  rules: string | null;
  instructions: string | null;
  qualification_criteria: string | null;
  funnel_phases: string | null;
  conversation_types: string | null;
  special_cases: string | null;
  followups: string | null;
  best_practices: string | null;
  winning_examples: string | null;
  calendar_mode: "off" | "slots" | "link";
  calendar_link: string | null;
  call_duration_min: number;
  default_calendar_id: string | null;
  model: string | null;
  sort_order: number;
  pipeline_id: string | null;
  is_default_lead: boolean;
  is_default_conversation: boolean;
  /** Ajustes de IA propios; null = usa los generales. */
  behavior: AgentBehavior | null;
  followup_enabled: boolean;
  followup_delays_min: number[];
  created_at: string;
  updated_at: string;
  channels?: Array<{ id: string; provider: string; display_name: string | null }>;
};

export type AgentBehavior = {
  multi_bubble?: boolean;
  first_reply_min_s?: number;
  first_reply_max_s?: number;
  active_hours_enabled?: boolean;
  active_hours_start?: number;
  active_hours_end?: number;
  timezone?: string;
};

export const AGENT_KIND_LABEL: Record<AgentKind, string> = {
  setter: "Setter",
  support: "Soporte",
  custom: "Personalizado",
};

let cache: Agent[] | null = null;

export function invalidateAgents() {
  cache = null;
}

/** Lista de agentes de la organización (con cache ligera). */
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Agent[]>("/api/agents");
      cache = rows;
      setAgents(rows);
    } catch {
      /* mantenemos lo que hubiera */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cache) void reload();
  }, [reload]);

  return { agents, loading, reload };
}
