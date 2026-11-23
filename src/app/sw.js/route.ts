import { serviceWorkerSource } from "@/lib/sw-source";

export const dynamic = "force-static";

/** Identificador del despliegue: commit en Vercel o, si no, la marca de tiempo de la compilación (la ruta es estática: se evalúa una vez por build). */
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString(36);

export function GET() {
  return new Response(serviceWorkerSource(BUILD_ID), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // El navegador debe comprobar siempre si hay un service worker nuevo
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
