import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// `connect-src`: en producción solo https/wss (API en Vercel + Supabase realtime).
// En desarrollo añadimos http/ws a localhost para poder llamar a la API local
// (http://localhost:3001) y para el hot-reload de Next.
const connectSrc = isDev
  ? "connect-src 'self' https: wss: http://localhost:* ws://localhost:*"
  : "connect-src 'self' https: wss:";

// Quién puede embeber la app en un iframe: GHL (y su marca blanca YouFunnelCloud)
// la abre como enlace de menú personalizado. Cualquier otro sitio queda bloqueado
// (anti-clickjacking). Se pueden añadir más con EMBED_ALLOWED_ORIGINS (espacios).
const frameAncestors = [
  "'self'",
  "https://app.gohighlevel.com",
  "https://*.gohighlevel.com",
  "https://*.leadconnectorhq.com",
  "https://*.msgsndr.com",
  "https://app.youfunnelcloud.com",
  "https://*.youfunnelcloud.com",
  ...(process.env.EMBED_ALLOWED_ORIGINS ?? "").split(/\s+/).filter(Boolean),
].join(" ");

const nextConfig: NextConfig = {
  // En un monorepo, la raíz del workspace está dos niveles por encima.
  // Esto evita avisos de "additional lockfiles" y mejora el file tracing.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Permite usar paquetes del workspace (TypeScript sin precompilar).
  transpilePackages: ["@wzp/shared"],

  // Cabeceras de seguridad del navegador para todo el frontend.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Sin X-Frame-Options: no admite lista de dominios; el anti-clickjacking
          // lo da `frame-ancestors` en la CSP.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Fuerza HTTPS durante 2 años (incluye subdominios).
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // CSP mínima: limita quién puede embeber la app (frame-ancestors) y
          // restringe orígenes. 'unsafe-inline'/'unsafe-eval' son necesarios
          // para el runtime de Next; endurecer con nonces en el futuro.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              connectSrc,
              "frame-src https://www.facebook.com https://web.facebook.com",
              `frame-ancestors ${frameAncestors}`,
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
