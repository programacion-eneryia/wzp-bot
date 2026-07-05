import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 48, margin: 0 }}>404</h1>
      <p style={{ opacity: 0.7 }}>La página que buscas no existe o se ha movido.</p>
      <Link href="/" style={{ textDecoration: "underline" }}>
        Volver al inicio
      </Link>
    </main>
  );
}
