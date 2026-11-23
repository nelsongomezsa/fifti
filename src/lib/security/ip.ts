import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/** IP del cliente (Vercel sobrescribe x-forwarded-for, así que el primer valor es fiable ahí). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip") || "unknown";
}

/** Hash con sal: en la tabla de rate limiting no se guardan IPs ni emails en claro. */
export function hashKey(value: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? "";
  return createHash("sha256").update(`${salt}:${value.toLowerCase()}`).digest("hex").slice(0, 32);
}
