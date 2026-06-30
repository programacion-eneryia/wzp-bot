import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // En un monorepo, la raíz del workspace está dos niveles por encima.
  // Esto evita avisos de "additional lockfiles" y mejora el file tracing.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Permite usar paquetes del workspace (TypeScript sin precompilar).
  transpilePackages: ["@wzp/shared"],
};

export default nextConfig;
