/**
 * Libera el puerto indicado antes de arrancar (evita EADDRINUSE por procesos
 * zombie que deja a veces el watcher de NestJS).
 *   node scripts/kill-port.mjs 3001
 */
import { execSync } from "node:child_process";

const port = process.argv[2] ?? "3001";
try {
  const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  if (out) {
    for (const pid of out.split("\n")) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // ya no existe
      }
    }
    console.log(`🧹 Puerto ${port} liberado (procesos: ${out.split("\n").join(", ")})`);
  }
} catch {
  // Nada escuchando en el puerto: perfecto.
}
