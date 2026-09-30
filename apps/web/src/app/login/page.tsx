import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Logo from "@/components/Brand/Logo";
import LoginForm from "./LoginForm";
import styles from "./login.module.css";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.glowSpot} aria-hidden />
      <div className={styles.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Logo size={34} />
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>Eneryeter</span>
        </div>
        <span className={styles.eyebrow}>Acceso</span>
        <h1 className={styles.title}>
          Entra a tu <span className="serif">panel</span>
        </h1>
        <p className={styles.sub}>Inicia sesión con tu cuenta de equipo.</p>
        <LoginForm />
        <p className={styles.foot}>
          ¿No tienes cuenta? Pídele acceso al administrador de tu organización.
        </p>
      </div>
    </main>
  );
}
