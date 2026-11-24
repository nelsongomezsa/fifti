import "server-only";
import { DEMO_USER_ID } from "@/lib/demo/fake-client";
import { hit, hitIp, type RateRule } from "./rate-limit";

/** Aplica el límite por IP y por usuario. true = permitido. */
export async function allow(rule: RateRule, userId: string): Promise<boolean> {
  if (userId === DEMO_USER_ID) return true; // la demo no escribe nada: sin límite compartido ni accesos a la base de datos
  const [a, b] = await Promise.all([hitIp(rule), hit(rule, `user:${userId}`)]);
  return a && b;
}
