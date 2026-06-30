import { createClient } from "@/lib/supabase/client";

const ADMIN_SESSION_KEY = "wzp_admin_session";
const IMPERSONATING_KEY = "wzp_impersonating";

/**
 * Inicia la impersonación: guarda la sesión actual (admin) para poder volver,
 * canjea el token de un solo uso por una sesión REAL del usuario objetivo.
 */
export async function startImpersonation(tokenHash: string, label: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    localStorage.setItem(
      ADMIN_SESSION_KEY,
      JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }),
    );
  }

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (error) {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    throw new Error(error.message);
  }
  localStorage.setItem(IMPERSONATING_KEY, label);
  // Tras impersonar, la org activa es la del usuario: limpiamos la selección.
  document.cookie = "org_id=; path=/; max-age=0";
  window.location.href = "/dashboard";
}

/** Vuelve a la cuenta de admin restaurando la sesión guardada. */
export async function exitImpersonation(): Promise<void> {
  const supabase = createClient();
  const raw = localStorage.getItem(ADMIN_SESSION_KEY);
  localStorage.removeItem(IMPERSONATING_KEY);
  localStorage.removeItem(ADMIN_SESSION_KEY);
  if (raw) {
    try {
      const { access_token, refresh_token } = JSON.parse(raw) as {
        access_token: string;
        refresh_token: string;
      };
      await supabase.auth.setSession({ access_token, refresh_token });
    } catch {
      await supabase.auth.signOut();
    }
  }
  window.location.href = "/dashboard/admin";
}

export function impersonatingLabel(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(IMPERSONATING_KEY);
}
