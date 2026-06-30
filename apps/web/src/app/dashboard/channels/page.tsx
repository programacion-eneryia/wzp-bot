import { createClient } from "@/lib/supabase/server";
import ChannelsManager, { type Channel } from "./ChannelsManager";
import styles from "./channels.module.css";

export default async function ChannelsPage() {
  const supabase = await createClient();

  // Rol del usuario en su organización (solo admins conectan canales).
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .limit(1)
    .maybeSingle();
  const isAdmin = membership?.role === "admin";

  // RLS solo devuelve los canales de la organización del usuario.
  const { data: channels } = await supabase
    .from("channels")
    .select("id, provider, status, display_name, last_error, created_at, connected_at")
    .order("created_at", { ascending: false });

  return (
    <div>
      <span className={styles.eyebrow}>Sistema · Canales</span>
      <h1 className={styles.title}>
        Conecta tus <span className="serif">canales</span>
      </h1>
      <p className={styles.lead}>
        Vincula WhatsApp, Instagram y Messenger con un clic. La conexión es segura:
        las credenciales las custodia Unipile, nosotros nunca las almacenamos.
      </p>

      <ChannelsManager
        initialChannels={(channels as Channel[]) ?? []}
        isAdmin={isAdmin}
      />
    </div>
  );
}
