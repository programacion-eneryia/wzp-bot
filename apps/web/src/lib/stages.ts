"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

export type PipelineStage = {
  id: string;
  key: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
};

/** Etapas de sistema (fallback mientras carga o si la API falla). */
export const DEFAULT_STAGES: PipelineStage[] = [
  { id: "new", key: "new", name: "Nuevo", color: "#64748b", sort_order: 10, is_system: true },
  { id: "qualifying", key: "qualifying", name: "Cualificando", color: "#0ea5e9", sort_order: 20, is_system: true },
  { id: "qualified", key: "qualified", name: "Cualificado", color: "#6366f1", sort_order: 30, is_system: true },
  { id: "calendar_sent", key: "calendar_sent", name: "Calendario enviado", color: "#f59e0b", sort_order: 40, is_system: true },
  { id: "call_scheduled", key: "call_scheduled", name: "Llamada agendada", color: "#22c55e", sort_order: 50, is_system: true },
  { id: "won", key: "won", name: "Ganado", color: "#16a34a", sort_order: 60, is_system: true },
  { id: "not_qualified", key: "not_qualified", name: "No cualificado", color: "#a1a1aa", sort_order: 70, is_system: true },
  { id: "lost", key: "lost", name: "Perdido", color: "#ef4444", sort_order: 80, is_system: true },
];

// Cache en memoria compartida entre componentes (misma pestaña).
let cache: PipelineStage[] | null = null;
let inflight: Promise<PipelineStage[]> | null = null;

async function fetchStages(): Promise<PipelineStage[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = apiFetch<PipelineStage[]>("/api/stages")
      .then((rows) => {
        cache = rows.length > 0 ? rows : DEFAULT_STAGES;
        return cache;
      })
      .catch(() => DEFAULT_STAGES)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Invalida la cache (tras editar etapas). */
export function invalidateStages() {
  cache = null;
}

/**
 * Etapas del pipeline de la organización, ordenadas, con helpers para pintar.
 * Devuelve las de sistema como fallback hasta que carga.
 */
export function useStages() {
  const [stages, setStages] = useState<PipelineStage[]>(cache ?? DEFAULT_STAGES);
  const [loading, setLoading] = useState(!cache);

  const reload = useCallback(async () => {
    invalidateStages();
    setLoading(true);
    const rows = await fetchStages();
    setStages(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStages().then((rows) => {
      if (!cancelled) {
        setStages(rows);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const byKey = useMemo(() => new Map(stages.map((s) => [s.key, s])), [stages]);
  const label = useCallback(
    (key: string | null | undefined) => (key ? byKey.get(key)?.name ?? key : "—"),
    [byKey],
  );
  const color = useCallback(
    (key: string | null | undefined) => (key ? byKey.get(key)?.color ?? "#64748b" : "#64748b"),
    [byKey],
  );

  return { stages, loading, label, color, byKey, reload };
}
