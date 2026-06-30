import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Lee la organización activa de la cookie (para multi-organización). */
export function getActiveOrgId(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)org_id=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function orgHeader(): Record<string, string> {
  const id = getActiveOrgId();
  return id ? { "X-Org-Id": id } : {};
}

/**
 * Llama a la API de NestJS adjuntando el token de sesión de Supabase.
 * Lanza Error con el mensaje del backend si la respuesta no es OK.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      ...orgHeader(),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Sube un archivo (multipart) a la API. No fija Content-Type para que el
 * navegador establezca el boundary del FormData.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...orgHeader() },
    body: form,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}
