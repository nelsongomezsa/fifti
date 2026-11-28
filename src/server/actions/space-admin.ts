"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/server/rpc-error";
import { notify } from "@/server/push";
import { clearedBody, deletedSpaceNotices } from "@/lib/account-delete";
import { removeSpaceReceipts } from "@/server/receipts";
import { warmContribution } from "@/server/currency-warm";

export type SimpleResult = { ok: boolean; error?: string };

const clearSchema = z.object({ spaceId: z.uuid(), confirmName: z.string().trim().min(1).max(60), deleteAccounts: z.boolean() }).strict();
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
  const { data: res, error } = await supabase.rpc("clear_space", { p_space: p.data.spaceId, p_delete_accounts: p.data.deleteAccounts });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  // La base ya ha comprobado que es quien creó el espacio y ha borrado sus gastos: fuera también las fotos
  await removeSpaceReceipts(p.data.spaceId);
  const r = res as { name: string; others: string[]; accounts?: number } | null;
  if (r?.others?.length) await notify(r.others, "space_cleared", (t) => ({ title: r.name, body: t(clearedBody(r.accounts ?? 0)), url: "/inicio" }));
  revalidatePath("/", "layout");
  return { ok: true };
}

const deleteSpaceSchema = z.object({ spaceId: z.uuid(), confirmName: z.string().trim().min(1).max(60) }).strict();
const leaveSchema = z.object({ spaceId: z.uuid() }).strict();

/** Borra el espacio entero (nunca el Personal). Solo quien lo creó, escribiendo su nombre; se avisa a los demás. */
export async function deleteSpace(input: unknown): Promise<SimpleResult> {
  const x = await getTx();
  const p = deleteSpaceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.planWrites, data.user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { data: sp } = await supabase.from("spaces").select("name").eq("id", p.data.spaceId).maybeSingle();
  if (!sp || p.data.confirmName.toLowerCase() !== sp.name.trim().toLowerCase()) return { ok: false, error: x("El nombre no coincide.") };
  const { data: res, error } = await supabase.rpc("delete_space", { p_space: p.data.spaceId });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  // La base ya ha comprobado el permiso y borrado los gastos: fuera también las fotos
  await removeSpaceReceipts(p.data.spaceId);
  const r = res as { name: string; others: string[]; moved: string[] } | null;
  if (r) {
    // A quien se le han mudado cuentas se le dice dónde están ahora
    for (const group of deletedSpaceNotices(r.others, r.moved)) {
      await notify(group.users, "space_cleared", (t) => ({ title: r.name, body: t(group.body), url: group.url }));
    }
  }
  revalidatePath("/", "layout");
  redirect("/inicio?borrado=espacio", RedirectType.replace);
}

/** Salir de un espacio que no es tuyo: tu historial se queda con tu nombre. */
export async function leaveSpace(input: unknown): Promise<SimpleResult> {
  const x = await getTx();
  const p = leaveSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.planWrites, data.user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("leave_space", { p_space: p.data.spaceId });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  redirect("/inicio?borrado=salida", RedirectType.replace);
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
