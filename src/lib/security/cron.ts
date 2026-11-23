import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Las rutas de cron solo aceptan `Authorization: Bearer <CRON_SECRET>` (comparación en tiempo constante). */
export function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return secret.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
