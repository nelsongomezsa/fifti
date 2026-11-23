import "server-only";
import { hit, hitIp, type RateRule } from "./rate-limit";

/** Aplica el límite por IP y por usuario. true = permitido. */
export async function allow(rule: RateRule, userId: string): Promise<boolean> {
  const [a, b] = await Promise.all([hitIp(rule), hit(rule, `user:${userId}`)]);
  return a && b;
}
