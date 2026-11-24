import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { buildDemoDb } from "./dataset";

export const DEMO_COOKIE = "fifti_demo";

/** ¿La petición es de la demo? Solo si hay cookie de demo y NINGUNA sesión real (una sesión real siempre manda). */
export async function isDemoRequest(): Promise<boolean> {
  const store = await cookies();
  if (store.get(DEMO_COOKIE)?.value !== "1") return false;
  return !store.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
}

/** Los datos ficticios se generan una vez por petición. */
export const demoDb = cache(() => buildDemoDb(new Date()));
