"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/server/rpc-error";
import { notify } from "@/server/push";
import { warmContribution } from "@/server/currency-warm";

export type SimpleResult = { ok: boolean; error?: string };

const clearSchema = z.object({ spaceId: z.uuid(), confirmName: z.string().trim().min(1).max(60) }).strict();
const contributeSchema = z.object({ spaceId: z.uuid(), amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS) }).strict();

/** Vacía un espacio (gastos, ingresos, plan, fijos, metas, préstamos). Solo su creador; se escribe el nombre para confirmar. */
export async function clearSpace(input: unknown): Promise<SimpleResult> {
  const x = await getTx();
  const p = clearSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.planWrites, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { data: sp } = await supabase.from("spaces").select("name, kind").eq("id", p.data.spaceId).maybeSingle();
  const shown = sp?.kind === "personal" ? "Personal" : sp?.name;
  if (!sp || p.data.confirmName.toLowerCase() !== String(shown).trim().toLowerCase()) return { ok: false, error: x("El nombre no coincide.") };
  const { data: res, error } = await supabase.rpc("clear_space", { p_space: p.data.spaceId });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  const r = res as { name: string; others: string[] } | null;
  if (r?.others?.length) await notify(r.others, "space_cleared", (t) => ({ title: r.name, body: t("Se han borrado los datos de este espacio."), url: "/inicio" }));
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Aportar al hogar: sale de Personal (partida Aportación al hogar) y entra en el hogar a nombre de quien aporta. */
export async function contributeHousehold(input: unknown): Promise<SimpleResult> {
  const x = await getTx();
  const p = contributeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.planWrites, data.user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  await warmContribution(supabase, p.data.spaceId);
  const { error } = await supabase.rpc("contribute_household", { p_space: p.data.spaceId, p_amount: p.data.amountCents });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  return { ok: true };
}
