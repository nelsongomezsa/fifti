"use server";

import { getTx } from "@/i18n/tx";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { matchRule, type RuleType } from "@/lib/rules/match";
import { displayName } from "@/lib/system-names";
import { buildPayers, buildSplits, yourShare, type Participant } from "@/lib/money";
import {
  categorySchema, commentSchema, expenseInputSchema, favoriteSchema, fundSchema, incomeInputSchema, reactionSchema,
} from "@/lib/validation/expense";
import { uuidSchema } from "@/lib/validation/spaces";
import { rpcMessage } from "@/server/rpc-error";
import type { FormState } from "./auth";
import { resolveFx } from "@/server/fx";
import { warmMovement } from "@/server/currency-warm";
import { notify } from "@/server/push";

/** Propuesta de regla tras corregir dos veces la misma categoría para un concepto. */
export type RuleHint = { spaceId: string; text: string; categoryId: string; categoryName: string };
export type SaveResult = { ok: true; id: string; shareCents: number; ruleHint?: RuleHint } | { ok: false; error: string };

async function ctx() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

/** Valida, recalcula el reparto en el servidor (nunca se confía en importes del cliente) y guarda de forma atómica. */
export async function saveExpense(input: unknown): Promise<SaveResult> {
  const x = await getTx();
  const parsed = expenseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: x(parsed.error.issues[0]?.message ?? "Datos no válidos") };
  const v = parsed.data;
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: x("Sesión caducada.") };

  const { data: space } = await supabase.from("spaces").select("id, name, kind, base_currency").eq("id", v.spaceId).maybeSingle();
  if (!space) return { ok: false, error: x("No encontramos esa burbuja.") };
  const { data: members } = await supabase.from("space_members").select("id, user_id, default_share_bp").eq("space_id", v.spaceId);
  const me = members?.find((m) => m.user_id === user.id);
  if (!members || !me) return { ok: false, error: x("No perteneces a esa burbuja.") };
  const known = new Set(members.map((m) => m.id));

  try {
    const personal = space.kind === "personal";
    const participantIds = personal ? [me.id] : v.participants;
    if (!participantIds.every((id) => known.has(id))) return { ok: false, error: x("Participante no válido.") };
    const participants: Participant[] = participantIds.map((id) => ({
      memberId: id, defaultBp: members.find((m) => m.id === id)?.default_share_bp ?? null,
    }));

    const fx = await resolveFx(space.base_currency, v.currency, v.spentAt);
    if (!fx) return { ok: false, error: x("No hemos podido obtener el tipo de cambio.") };
    const baseCents = Math.round(v.amountCents * fx);

    const splits = buildSplits(baseCents, personal ? "equal" : v.splitMode, participants, v.custom);
    let payers: ReturnType<typeof buildPayers> = [];
    if (v.paidFrom === "member") {
      const list = personal || v.payers.length === 0 ? [{ memberId: me.id }] : v.payers;
      if (!list.every((p) => known.has(p.memberId))) return { ok: false, error: x("Pagador no válido.") };
      // Con varios pagadores los importes llegan en la moneda original: se convierten con el mismo cambio.
      payers = buildPayers(baseCents, list.length > 1 ? scaleToBase(list as { memberId: string; amountCents: number }[], v.amountCents, baseCents) : list);
    }

    const prev = v.id ? (await supabase.from("expenses").select("category_id").eq("id", v.id).maybeSingle()).data : null;
    await warmMovement(supabase, { spaceId: v.spaceId, userId: user.id, day: v.spentAt, currency: v.currency, accountId: v.accountId, movementId: v.id });
    const { data, error } = await supabase.rpc("save_expense", {
      p: {
        id: v.id ?? null, client_id: v.clientId, space_id: v.spaceId, description: v.description, category_id: v.categoryId ?? null,
        spent_at: v.spentAt, amount_cents: v.amountCents, currency: v.currency, fx_rate: fx, amount_base_cents: baseCents,
        paid_from: v.paidFrom, split_mode: personal ? "equal" : v.splitMode, is_private: v.isPrivate && !personal, tags: v.tags,
        payers: payers.map((p) => ({ member_id: p.memberId, amount_cents: p.amountCents })),
        splits: splits.map((s) => ({ member_id: s.memberId, share_bp: s.shareBp, amount_cents: s.amountCents })),
      },
    });
    if (error) return { ok: false, error: x(rpcMessage(error)) };
    if (v.accountId !== undefined) {
      const acc = await supabase.rpc("set_movement_account", { p_kind: "expense", p_id: data as string, p_account: v.accountId });
      if (acc.error) return { ok: false, error: x(rpcMessage(acc.error)) };
    }
    revalidatePath("/", "layout");
    if (!v.id && !personal) {
      const others = (await supabase.from("space_members").select("user_id").eq("space_id", v.spaceId).not("user_id", "is", null)).data ?? [];
      await notify(others.map((m) => m.user_id as string).filter((u) => u !== user.id), "new_expense", (t) => ({ title: space.name, body: t("Hay un gasto nuevo."), url: "/movimientos" }));
    }
    let ruleHint: RuleHint | undefined;
    if (v.id && v.categoryId && prev && prev.category_id !== v.categoryId && !personalPrivate(v)) {
      ruleHint = await learnRule(supabase, v.spaceId, v.description, v.categoryId);
    }
    return { ok: true, id: data as string, shareCents: yourShare(splits, me.id), ...(ruleHint ? { ruleHint } : {}) };
  } catch (err) {
    if (err instanceof RangeError) return { ok: false, error: x(err.message) };
    console.error("[saveExpense]", err instanceof Error ? err.message : "error");
    return { ok: false, error: x("No se ha podido guardar el gasto.") };
  }
}

const personalPrivate = (v: { isPrivate: boolean }) => v.isPrivate;

/** Cuenta la corrección; a la 2.ª vez con el mismo concepto y sin regla que ya lo cubra, propone crearla. */
async function learnRule(supabase: Awaited<ReturnType<typeof createClient>>, spaceId: string, text: string, categoryId: string): Promise<RuleHint | undefined> {
  const key = text.trim().slice(0, 60);
  if (!key) return undefined;
  const { data: hits, error } = await supabase.rpc("bump_rule_hint", { p_space: spaceId, p_text: key, p_category: categoryId });
  if (error || (hits as number) < 2) return undefined;
  const [{ data: rules }, { data: cat }] = await Promise.all([
    supabase.from("category_rules").select("id, match_text, match_type, category_id, priority").eq("space_id", spaceId),
    supabase.from("categories").select("name, system_key").eq("id", categoryId).maybeSingle(),
  ]);
  const covered = matchRule((rules ?? []).map((r) => ({ id: r.id, matchText: r.match_text, matchType: r.match_type as RuleType, categoryId: r.category_id, priority: r.priority })), key);
  if (covered?.categoryId === categoryId || !cat) return undefined;
  const x = await getTx();
  return { spaceId, text: key, categoryId, categoryName: displayName(x, cat.name, cat.system_key) };
}

/** Reparte el importe base entre varios pagadores en proporción a lo que puso cada uno. */
function scaleToBase(list: { memberId: string; amountCents: number }[], original: number, base: number) {
  if (original === base) return list;
  const total = list.reduce((a, b) => a + b.amountCents, 0);
  if (total !== original) throw new RangeError("Los pagos no suman el importe");
  let acc = 0;
  return list.map((p, i) => {
    const amt = i === list.length - 1 ? base - acc : Math.round((p.amountCents * base) / original);
    acc += amt;
    return { memberId: p.memberId, amountCents: amt };
  });
}

async function removeExpense(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const x = await getTx();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.deletes, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("delete_expense", { p_id: id });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  return { ok: true };
}

/** Borrar sin moverse de pantalla (deslizar en la lista, «Deshacer»). */
export async function deleteExpense(id: string): Promise<{ ok: boolean; error?: string }> {
  // Sin revalidatePath: quien borra refresca él mismo
  return removeExpense(id);
}

/** Borrar desde el detalle: la redirección viaja en la propia respuesta, así el gasto borrado no se vuelve a pintar. */
export async function deleteExpenseAndGo(id: string): Promise<{ ok: false; error: string }> {
  const r = await removeExpense(id);
  if (!r.ok) return r;
  revalidatePath("/movimientos");
  redirect("/movimientos?borrado=1", RedirectType.replace);
}

export async function addComment(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = commentSchema.safeParse({ expenseId: fd.get("expenseId"), spaceId: fd.get("spaceId"), body: fd.get("body") });
  if (!parsed.success) return { error: x("Escribe un comentario (máx. 500 caracteres).") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  if (!(await allow(RULES.comment, user.id))) return { error: x("Demasiados comentarios. Espera un momento.") };
  const { data: me } = await supabase.from("space_members").select("id").eq("space_id", parsed.data.spaceId).eq("user_id", user.id).maybeSingle();
  if (!me) return { error: x("No autorizado.") };
  const { error } = await supabase.from("expense_comments").insert({
    expense_id: parsed.data.expenseId, space_id: parsed.data.spaceId, member_id: me.id, body: parsed.data.body,
  });
  if (error) return { error: x("No se ha podido comentar.") };
  revalidatePath(`/movimientos/${parsed.data.expenseId}`);
  return { ok: true };
}

export async function toggleReaction(fd: FormData) {
  const parsed = reactionSchema.safeParse({ expenseId: fd.get("expenseId"), spaceId: fd.get("spaceId"), emoji: fd.get("emoji") });
  if (!parsed.success) return;
  const { supabase, user } = await ctx();
  if (!user) return;
  const { data: me } = await supabase.from("space_members").select("id").eq("space_id", parsed.data.spaceId).eq("user_id", user.id).maybeSingle();
  if (!me) return;
  const row = { expense_id: parsed.data.expenseId, space_id: parsed.data.spaceId, member_id: me.id, emoji: parsed.data.emoji };
  const { data: existing } = await supabase.from("expense_reactions").select("emoji").match(row).maybeSingle();
  if (existing) await supabase.from("expense_reactions").delete().match(row);
  else await supabase.from("expense_reactions").insert(row);
  revalidatePath(`/movimientos/${parsed.data.expenseId}`);
}

export async function saveIncome(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const { parseToCents } = await import("@/lib/money");
  const cents = parseToCents(String(fd.get("amount") ?? ""));
  const parsed = incomeInputSchema.safeParse({
    id: fd.get("id") || undefined, spaceId: fd.get("spaceId"), memberId: fd.get("memberId"), amountCents: cents ?? 0,
    source: String(fd.get("source") ?? "Nómina") || "Nómina", receivedAt: fd.get("receivedAt"), isRecurring: fd.get("isRecurring") === "on",
    accountId: fd.has("accountId") ? (String(fd.get("accountId")) || null) : undefined,
  });
  if (!parsed.success) return { error: x(parsed.error.issues[0]?.message ?? "Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const v = parsed.data;
  await warmMovement(supabase, { spaceId: v.spaceId, userId: user.id, day: v.receivedAt, accountId: v.accountId, movementId: v.id, table: "incomes" });
  const { data: incomeId, error } = await supabase.rpc("save_income", {
    p: { id: v.id ?? null, space_id: v.spaceId, member_id: v.memberId, amount_cents: v.amountCents, source: v.source, received_at: v.receivedAt, is_recurring: v.isRecurring },
  });
  if (error) return { error: x(rpcMessage(error)) };
  if (v.accountId !== undefined && incomeId) {
    const acc = await supabase.rpc("set_movement_account", { p_kind: "income", p_id: (incomeId as string) ?? v.id, p_account: v.accountId });
    if (acc.error) return { error: x(rpcMessage(acc.error)) };
  }
  revalidatePath("/", "layout");
  // Día de cobro: si hay partidas con cuenta asociada, un aviso genérico (sin importes) recuerda repartir la nómina
  if (!v.id && /n[oó]mina/i.test(v.source)) {
    const { count } = await supabase.from("funds").select("id", { count: "exact", head: true }).eq("space_id", v.spaceId).not("account_id", "is", null);
    if ((count ?? 0) > 0) await notify([user.id], "payday_split", (t) => ({ title: "Fifti", body: t("Es día de cobro: reparte tu nómina entre tus cuentas."), url: "/inicio" }));
  }
  return { ok: true, message: x("Ingreso guardado.") };
}

export async function deleteIncome(fd: FormData) {
  const id = uuidSchema.safeParse(fd.get("incomeId"));
  if (!id.success) return;
  const { supabase, user } = await ctx();
  if (!user) return;
  await supabase.rpc("delete_income", { p_id: id.data });
  revalidatePath("/", "layout");
}

export async function addFund(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = fundSchema.safeParse({ spaceId: fd.get("spaceId"), name: fd.get("name"), kind: fd.get("kind") || "other" });
  if (!parsed.success) return { error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { error } = await supabase.from("funds").insert({ space_id: parsed.data.spaceId, name: parsed.data.name, kind: parsed.data.kind });
  if (error) return { error: x("No se ha podido crear el fondo.") };
  revalidatePath(`/espacio/${parsed.data.spaceId}/fondos`);
  return { ok: true, message: x("Fondo creado.") };
}

export async function addCategory(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = categorySchema.safeParse({ spaceId: fd.get("spaceId"), fundId: fd.get("fundId"), name: fd.get("name") });
  if (!parsed.success) return { error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { error } = await supabase.from("categories").insert({ space_id: parsed.data.spaceId, fund_id: parsed.data.fundId, name: parsed.data.name });
  if (error) return { error: x("No se ha podido crear la categoría.") };
  revalidatePath(`/espacio/${parsed.data.spaceId}/fondos`);
  return { ok: true, message: x("Categoría creada.") };
}

export async function saveFavorite(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const x = await getTx();
  const parsed = favoriteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  const { count } = await supabase.from("favorites").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 20) return { ok: false, error: x("Máximo 20 favoritos.") };
  const { error } = await supabase.from("favorites").insert({
    user_id: user.id, space_id: parsed.data.spaceId, label: parsed.data.label, amount_cents: parsed.data.amountCents, category_id: parsed.data.categoryId ?? null,
  });
  return error ? { ok: false, error: x("No se ha podido guardar.") } : { ok: true };
}

export async function deleteFavorite(fd: FormData) {
  const id = uuidSchema.safeParse(fd.get("favoriteId"));
  if (!id.success) return;
  const { supabase, user } = await ctx();
  if (!user) return;
  await supabase.from("favorites").delete().eq("id", id.data).eq("user_id", user.id);
  revalidatePath("/ajustes");
}

export async function addFavoriteForm(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const { parseToCents } = await import("@/lib/money");
  const res = await saveFavorite({
    spaceId: fd.get("spaceId"), label: fd.get("label"), amountCents: parseToCents(String(fd.get("amount") ?? "")) ?? 0, categoryId: null,
  });
  if (res.ok) revalidatePath("/ajustes");
  return res.ok ? { ok: true, message: x("Favorito guardado.") } : { error: x(res.error ?? "No se ha podido guardar.") };
}
