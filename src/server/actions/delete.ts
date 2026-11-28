"use server";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { DELETE_KINDS } from "@/lib/delete-kinds";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { deleteExpense } from "@/server/actions/expenses";
import { rpcMessage } from "@/server/rpc-error";

export type DeleteResult = { ok: boolean; error?: string };

const itemSchema = z.object({ kind: z.enum(DELETE_KINDS), id: z.uuid() }).strict();

/** Un solo camino para borrar: valida, comprueba sesión y límite; el permiso y el rastro los pone la base. */
async function remove(input: unknown): Promise<DeleteResult> {
  const x = await getTx();
  const p = itemSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  // El gasto tiene su propio camino porque además se lleva la foto del ticket
  if (p.data.kind === "expense") return deleteExpense(p.data.id);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.deletes, data.user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = p.data.kind === "income_rule"
    ? await supabase.rpc("delete_income_rule", { p_id: p.data.id })
    : await supabase.rpc("delete_item", { p_kind: p.data.kind, p_id: p.data.id });
  return error ? { ok: false, error: x(rpcMessage(error)) } : { ok: true };
}

/** Borrar sin moverse de pantalla (listas). Quien llama refresca. */
export async function deleteItem(input: unknown): Promise<DeleteResult> {
  return remove(input);
}

/** Borrar desde una pantalla de detalle: la redirección viaja en la misma respuesta y no se llega a pedir lo borrado. */
export async function deleteGoalAndGo(id: unknown): Promise<DeleteResult> {
  const r = await remove({ kind: "goal", id });
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  redirect("/plan?vista=ahorro&borrado=meta", RedirectType.replace);
}
