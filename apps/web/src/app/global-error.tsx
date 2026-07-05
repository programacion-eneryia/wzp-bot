"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 32, margin: 0 }}>Algo ha ido mal</h1>
        <p style={{ opacity: 0.7 }}>
          Ha ocurrido un error inesperado. Vuelve a intentarlo.
        </p>
        <button
          onClick={() => reset()}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid currentColor",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
