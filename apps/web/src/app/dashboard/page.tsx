import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Dashboard from "./Dashboard";

export default async function DashboardHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.is_platform_admin) redirect("/dashboard/admin");

  // Organización activa (misma lógica que el layout).
  const { data: memRows } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);
  const cookieOrg = (await cookies()).get("org_id")?.value ?? null;
  const orgId =
    memRows?.find((m) => m.organization_id === cookieOrg)?.organization_id ??
    memRows?.[0]?.organization_id ??
    null;

  // Primera vez en una organización nueva → tour de onboarding.
  if (orgId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("onboarding_completed_at")
      .eq("id", orgId)
      .maybeSingle();
    if (org && !org.onboarding_completed_at) redirect("/dashboard/onboarding");
  }

  const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0] || null;

  return <Dashboard firstName={firstName} />;
}
