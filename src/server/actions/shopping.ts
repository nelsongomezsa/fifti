"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/server/rpc-error";
import { saveExpense } from "./expenses";

const addSchema = z.object({ spaceId: z.uuid(), text: z.string().trim().min(1).max(120), quantity: z.number().int().min(1).max(999) }).strict();
const toggleSchema = z.object({ spaceId: z.uuid(), id: z.uuid(), checked: z.boolean() }).strict();
const finishSchema = z.object({ spaceId: z.uuid(), totalCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS) }).strict();

export type ShoppingItem = { id: string; text: string; quantity: number; checked: boolean; addedBy: string | null };
type Res = { ok: true } | { ok: false; error: string };

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function addShoppingItem(input: unknown): Promise<Res & { item?: ShoppingItem }> {
  const x = await getTx();
  const p = addSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const { supabase, user } = await session();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.shopping, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { data: list, error: le } = await supabase.rpc("ensure_shopping_list", { p_space: p.data.spaceId });
  if (le) return { ok: false, error: x(rpcMessage(le)) };
  const { data, error } = await supabase.from("shopping_items").insert({ list_id: list as string, space_id: p.data.spaceId, text: p.data.text, quantity: p.data.quantity })
    .select("id, text, quantity, checked, added_by").single();
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  return { ok: true, item: { id: data.id, text: data.text, quantity: data.quantity, checked: data.checked, addedBy: data.added_by } };
}

export async function toggleShoppingItem(input: unknown): Promise<Res> {
  const x = await getTx();
  const p = toggleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const { supabase, user } = await session();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.shopping, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.from("shopping_items").update({ checked: p.data.checked }).eq("id", p.data.id).eq("space_id", p.data.spaceId);
  return error ? { ok: false, error: x(rpcMessage(error)) } : { ok: true };
}

/** "Terminar compra": crea el gasto en esta burbuja (categoría Súper, reparto por defecto), deja los artículos como comentario y abre una lista nueva. */
export async function finishShopping(input: unknown): Promise<Res & { expenseId?: string }> {
  const x = await getTx();
  const p = finishSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Pon el total de la compra.") };
  const { supabase, user } = await session();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.shopping, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };

  const [{ data: space }, { data: members }, { data: cats }, { data: me }] = await Promise.all([
    supabase.from("spaces").select("kind, base_currency").eq("id", p.data.spaceId).maybeSingle(),
    supabase.from("space_members").select("id").eq("space_id", p.data.spaceId),
    supabase.from("categories").select("id, system_key").eq("space_id", p.data.spaceId),
    supabase.from("space_members").select("id").eq("space_id", p.data.spaceId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!space || space.kind === "personal" || !members || !me) return { ok: false, error: x("No autorizado.") };
  const groceries = cats?.find((c) => c.system_key === "cat.groceries") ?? cats?.find((c) => c.system_key === "cat.purchase") ?? cats?.find((c) => c.system_key === "cat.food");

  const saved = await saveExpense({
    clientId: crypto.randomUUID(), spaceId: p.data.spaceId, description: x("Compra"), categoryId: groceries?.id ?? null, spentAt: new Date().toISOString().slice(0, 10),
    amountCents: p.data.totalCents, currency: space.base_currency, paidFrom: "member", splitMode: "default", participants: members.map((m) => m.id), payers: [], isPrivate: false, tags: [],
  });
  if (!saved.ok) return { ok: false, error: saved.error };
  const { data: names, error } = await supabase.rpc("finish_shopping", { p_space: p.data.spaceId, p_expense: saved.id });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  if (names) await supabase.from("expense_comments").insert({ expense_id: saved.id, space_id: p.data.spaceId, member_id: me.id, body: `${x("Artículos:")} ${names as string}`.slice(0, 500) });
  revalidatePath("/", "layout");
  return { ok: true, expenseId: saved.id };
}

/**
 * Excepción documentada en SECURITY.md: Realtime necesita el JWT en el navegador y las cookies son httpOnly.
 * Devuelve SOLO el access_token (caduca en ≤ 1 h) y su caducidad; nunca el refresh_token. Con rate limit y solo a quien ya tiene sesión.
 */
export async function realtimeAccess(): Promise<{ token: string; expiresAt: number } | null> {
  const { supabase, user } = await session();
  if (!user || user.app_metadata?.demo === true) return null; // la demo no usa Realtime
  if (!(await allow(RULES.realtimeToken, user.id))) return null;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  return s?.access_token ? { token: s.access_token, expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + 600 } : null;
}
