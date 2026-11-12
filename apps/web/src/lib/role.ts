import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Rol del usuario en la organización ACTIVA (la del cookie `org_id`, o la
 * primera si no hay cookie), igual que lo resuelve el layout. Los admins de
 * plataforma cuentan como admin. Para páginas server-side.
 */
export async function getActiveRole(): Promise<{ role: string | null; isAdmin: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { role: null, isAdmin: false };

  const [{ data: profile }, { data: memRows }] = await Promise.all([
    supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle(),
    supabase.from("memberships").select("organization_id, role").eq("user_id", user.id),
  ]);
  const cookieOrg = (await cookies()).get("org_id")?.value ?? null;
  const memberships = memRows ?? [];
  const active =
    memberships.find((m) => m.organization_id === cookieOrg) ?? memberships[0] ?? null;
  const role = (active?.role as string | undefined) ?? null;
  return { role, isAdmin: role === "admin" || Boolean(profile?.is_platform_admin) };
}
