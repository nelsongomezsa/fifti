import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, hashKey } from "./ip";

export type RateRule = { action: string; limit: number; windowSeconds: number };

/** Reglas por acción. Todas se aplican por IP; las de cuenta, además por email/usuario. */
export const RULES = {
  login: { action: "login", limit: 10, windowSeconds: 900 },
  loginEmail: { action: "login-email", limit: 5, windowSeconds: 900 },
  signup: { action: "signup", limit: 5, windowSeconds: 3600 },
  recover: { action: "recover", limit: 5, windowSeconds: 3600 },
  recoverEmail: { action: "recover-email", limit: 3, windowSeconds: 3600 },
  passwordChange: { action: "password-change", limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, RateRule>;

/** true = permitido. Si el limitador falla, se deniega (falla cerrado) y se registra el error. */
export async function hit(rule: RateRule, subject: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_key: `${rule.action}:${hashKey(subject)}`,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.error("[rate-limit]", err instanceof Error ? err.message : "error");
    return false;
  }
}

export async function hitIp(rule: RateRule): Promise<boolean> {
  return hit(rule, `ip:${await clientIp()}`);
}
