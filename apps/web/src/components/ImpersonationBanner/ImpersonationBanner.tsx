"use client";

import { useEffect, useState } from "react";
import { exitImpersonation, impersonatingLabel } from "@/lib/impersonation";
import styles from "./ImpersonationBanner.module.css";

export default function ImpersonationBanner() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(impersonatingLabel());
  }, []);

  if (!label) return null;

  return (
    <div className={styles.banner}>
      <span>
        Estás viendo la plataforma como <strong>{label}</strong> (modo impersonación).
      </span>
      <button className={styles.exitBtn} onClick={() => void exitImpersonation()}>
        Volver a mi cuenta
      </button>
    </div>
  );
}
