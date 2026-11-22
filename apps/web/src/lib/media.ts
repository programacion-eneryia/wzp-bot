"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type MediaKind = "audio" | "video" | "image" | "document";

export type MediaAsset = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  kind: MediaKind;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  as_voice_note: boolean;
  ai_enabled: boolean;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
};

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  audio: "Audio",
  video: "Vídeo",
  image: "Imagen",
  document: "Documento",
};

export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export function kindFromMime(mime: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  return "document";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

let cache: MediaAsset[] | null = null;

/** Biblioteca de archivos de la organización (con cache ligera). */
export function useMedia() {
  const [assets, setAssets] = useState<MediaAsset[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await apiFetch<MediaAsset[]>("/api/media");
      cache = rows;
      setAssets(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la biblioteca");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Siempre se refresca al montar (puede haber cambios desde otra pestaña);
    // la cache solo evita el parpadeo inicial.
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  return { assets, loading, error, reload };
}

/**
 * Sube un archivo: pide a la API una URL firmada, sube el archivo DIRECTO a
 * Storage (la API no admite cuerpos grandes) y registra el archivo.
 */
export async function uploadMedia(
  file: File,
  meta: {
    name: string;
    description?: string | null;
    as_voice_note?: boolean;
    ai_enabled?: boolean;
    agent_id?: string | null;
  },
  onProgress?: (pct: number) => void,
): Promise<MediaAsset> {
  if (file.size > MEDIA_MAX_BYTES) {
    throw new Error("El archivo supera los 16 MB que admite WhatsApp");
  }
  const mime = file.type || guessMime(file.name);
  const { path, upload_url } = await apiFetch<{ path: string; upload_url: string; token: string }>(
    "/api/media/upload-url",
    {
      method: "POST",
      body: JSON.stringify({ filename: file.name, mime_type: mime, size_bytes: file.size }),
    },
  );

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", upload_url);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`No se pudo subir el archivo (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("No se pudo subir el archivo"));
    xhr.send(file);
  });

  return apiFetch<MediaAsset>("/api/media", {
    method: "POST",
    body: JSON.stringify({
      name: meta.name,
      description: meta.description ?? null,
      storage_path: path,
      mime_type: mime,
      size_bytes: file.size,
      as_voice_note: meta.as_voice_note ?? false,
      ai_enabled: meta.ai_enabled ?? true,
      agent_id: meta.agent_id ?? null,
    }),
  });
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    opus: "audio/opus",
    wav: "audio/wav",
    mp4: "video/mp4",
    mov: "video/quicktime",
    "3gp": "video/3gpp",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}
