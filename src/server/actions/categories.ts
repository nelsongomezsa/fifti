"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/server/rpc-error";

type Result = { ok: boolean; error?: string };

const deleteCategorySchema = z.object({ id: z.uuid(), moveTo: z.uuid().nullable() }).strict();
const hiddenSchema = z.object({ id: z.uuid(), hidden: z.boolean() }).strict();
const deleteFundSchema = z.object({ id: z.uuid(), moveTo: z.uuid() }).strict();
const tagSchema = z.object({ expenseId: z.uuid(), tagId: z.uuid() }).strict();

/** Validación, sesión y límite; el permiso y el rastro los pone la función de la base. */
async function call(valid: boolean, fn: string, args: Record<string, unknown>): Promise<Result> {
  const x = await getTx();
  if (!valid) return { ok: false, error: x("Datos no válidos") };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.deletes, data.user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteCategory(input: unknown): Promise<Result> {
  const p = deleteCategorySchema.safeParse(input);
  return call(p.success, "delete_category", { p_id: p.data?.id, p_move_to: p.data?.moveTo });
}

export async function setCategoryHidden(input: unknown): Promise<Result> {
  const p = hiddenSchema.safeParse(input);
  return call(p.success, "set_category_hidden", { p_id: p.data?.id, p_hidden: p.data?.hidden });
}

export async function deleteFund(input: unknown): Promise<Result> {
  const p = deleteFundSchema.safeParse(input);
  return call(p.success, "delete_fund", { p_id: p.data?.id, p_move_to: p.data?.moveTo });
}

export async function removeExpenseTag(input: unknown): Promise<Result> {
  const p = tagSchema.safeParse(input);
  return call(p.success, "remove_expense_tag", { p_expense: p.data?.expenseId, p_tag: p.data?.tagId });
}
