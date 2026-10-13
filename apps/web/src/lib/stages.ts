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
  pipeline_id?: string | null;
};

export type Pipeline = {
  id: string;
  key: string;
  name: string;
  sort_order: number;
  is_default: boolean;
  stages: PipelineStage[];
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

const FALLBACK_PIPELINES: Pipeline[] = [
  { id: "default", key: "setter", name: "Setter", sort_order: 10, is_default: true, stages: DEFAULT_STAGES },
];

// Cache en memoria compartida entre componentes (misma pestaña).
let cache: Pipeline[] | null = null;
let inflight: Promise<Pipeline[]> | null = null;

async function fetchPipelines(): Promise<Pipeline[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = apiFetch<Pipeline[]>("/api/stages/pipelines")
      .then((rows) => {
        cache = rows.length > 0 ? rows : FALLBACK_PIPELINES;
        return cache;
      })
      .catch(() => FALLBACK_PIPELINES)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Invalida la cache (tras editar pipelines o etapas). */
export function invalidateStages() {
  cache = null;
}

/**
 * Pipelines de la organización con sus etapas, y helpers para pintar.
 * `stages` es la lista plana (pipeline por pipeline, en orden).
 */
export function useStages() {
  const [pipelines, setPipelines] = useState<Pipeline[]>(cache ?? FALLBACK_PIPELINES);
  const [loading, setLoading] = useState(!cache);

  const reload = useCallback(async () => {
    invalidateStages();
    setLoading(true);
    const rows = await fetchPipelines();
    setPipelines(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPipelines().then((rows) => {
      if (!cancelled) {
        setPipelines(rows);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stages = useMemo(
    () => pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline_id: p.id }))),
    [pipelines],
  );
  const byKey = useMemo(() => new Map(stages.map((s) => [s.key, s])), [stages]);
  const defaultPipeline = useMemo(
    () => pipelines.find((p) => p.is_default) ?? pipelines[0] ?? null,
    [pipelines],
  );
  const label = useCallback(
    (key: string | null | undefined) => (key ? byKey.get(key)?.name ?? key : "—"),
    [byKey],
  );
  const color = useCallback(
    (key: string | null | undefined) => (key ? byKey.get(key)?.color ?? "#64748b" : "#64748b"),
    [byKey],
  );
  /** Etapas de un pipeline (null = el por defecto). */
  const stagesOf = useCallback(
    (pipelineId: string | null | undefined) => {
      const p = pipelines.find((x) => x.id === pipelineId) ?? defaultPipeline;
      return p?.stages ?? [];
    },
    [pipelines, defaultPipeline],
  );
  /** Pipeline al que pertenece una etapa. */
  const pipelineOf = useCallback(
    (key: string | null | undefined) => {
      const id = key ? byKey.get(key)?.pipeline_id : null;
      return pipelines.find((p) => p.id === id) ?? defaultPipeline;
    },
    [byKey, pipelines, defaultPipeline],
  );

  return {
    stages,
    pipelines,
    defaultPipeline,
    loading,
    label,
    color,
    byKey,
    stagesOf,
    pipelineOf,
    reload,
  };
}
