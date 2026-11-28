"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/server/rpc-error";

type Result = { ok: boolean; error?: string };

const activeSchema = z.object({ id: z.uuid(), active: z.boolean() }).strict();
const skipSchema = z.object({ ruleId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), skip: z.boolean() }).strict();

/** Validación, sesión y límite; el permiso lo comprueba la función de la base. */
async function call(valid: boolean, fn: string, args: Record<string, unknown>): Promise<Result> {
  const x = await getTx();
  if (!valid) return { ok: false, error: x("Datos no válidos") };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.planWrites, data.user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setIncomeRuleActive(input: unknown): Promise<Result> {
  const p = activeSchema.safeParse(input);
  return call(p.success, "set_income_rule_active", { p_id: p.data?.id, p_active: p.data?.active });
}

export async function setIncomeSkip(input: unknown): Promise<Result> {
  const p = skipSchema.safeParse(input);
  return call(p.success, "set_income_skip", { p_rule: p.data?.ruleId, p_date: p.data?.date, p_skip: p.data?.skip });
}
