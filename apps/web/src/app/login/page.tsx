import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
        <span className={styles.eyebrow}>Acceso · WZP</span>
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
