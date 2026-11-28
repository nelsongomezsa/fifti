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
import { currencySchema } from "@/lib/validation/spaces";
import { warmContribution, warmMovement } from "@/server/currency-warm";
import { warmRates } from "@/server/fx";

export type AccountResult = { ok: boolean; error?: string; id?: string };

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)));
const signed = z.number().int().min(-MAX_AMOUNT_CENTS).max(MAX_AMOUNT_CENTS);
const positive = z.number().int().min(1).max(MAX_AMOUNT_CENTS);

const accountSchema = z.object({
  id: z.uuid().optional(), spaceId: z.uuid(), name: z.string().trim().min(1).max(60), bank: z.string().trim().max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), kind: z.enum(["payroll", "daily", "savings", "shared"]),
  openingCents: signed, openingDate: iso, isDefault: z.boolean(), currency: currencySchema.optional(),
}).strict();
const archiveSchema = z.object({ id: z.uuid(), archived: z.boolean() }).strict();
const transferSchema = z.object({
  fromId: z.uuid(), toId: z.uuid(), amountCents: positive, date: iso, note: z.string().trim().max(80).optional(),
  source: z.enum(["manual", "payroll_split"]).default("manual"), toAmountCents: positive.optional(),
}).strict();
const idSchema = z.object({ id: z.uuid() }).strict();
const adjustSchema = z.object({ accountId: z.uuid(), targetCents: signed, note: z.string().trim().max(80).optional() }).strict();
const fundSchema = z.object({ fundId: z.uuid(), accountId: z.uuid().nullable() }).strict();
const movementSchema = z.object({ kind: z.enum(["expense", "income", "recurring"]), id: z.uuid(), accountId: z.uuid().nullable() }).strict();

async function session() {
  const x = await getTx();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const limited = user ? !(await allow(RULES.planWrites, user.id)) : false;
  return { x, supabase, user, limited };
}
const done = (path = "/") => { revalidatePath(path, "layout"); };

export async function saveAccount(input: unknown): Promise<AccountResult> {
  const p = accountSchema.safeParse(input);
  const { x, supabase, user, limited } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (limited) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const v = p.data;
  const { data, error } = await supabase.rpc("save_account", { p: { id: v.id ?? null, space_id: v.spaceId, name: v.name, bank: v.bank ?? "", color: v.color, kind: v.kind, opening_cents: v.openingCents, opening_date: v.openingDate, is_default: v.isDefault, currency: v.currency ?? null } });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  done();
  return { ok: true, id: data as string };
}

export async function archiveAccount(input: unknown): Promise<AccountResult> {
  const p = archiveSchema.safeParse(input);
  const { x, supabase, user, limited } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (limited) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("archive_account", { p_id: p.data.id, p_archived: p.data.archived });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  done();
  return { ok: true };
}

/** Borra una cuenta (solo la persona dueña; lo comprueba la base) y vuelve a Mis cuentas. Si falla, no se mueve. */
export async function removeBankAccount(input: unknown): Promise<AccountResult> {
  const p = idSchema.safeParse(input);
  const { x, supabase, user, limited } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (limited || !(await allow(RULES.deletes, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("delete_account", { p_id: p.data.id });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  done();
  redirect("/cuentas?borrado=1", RedirectType.replace);
}

export async function createTransfer(input: unknown): Promise<AccountResult> {
  const p = transferSchema.safeParse(input);
  const { x, supabase, user, limited } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (limited) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const v = p.data;
  const { data: both } = await supabase.from("accounts").select("id, space_id, currency").in("id", [v.fromId, v.toId]);
  const from = both?.find((a) => a.id === v.fromId), to = both?.find((a) => a.id === v.toId);
  if (from && to) {
    const { data: home } = await supabase.from("spaces").select("kind, base_currency").eq("id", to.space_id).maybeSingle();
    if (home?.kind === "household") {
      await warmRates([{ from: from.currency, to: home.base_currency, day: v.date }]);
      await warmContribution(supabase, to.space_id);
    }
  }
  const { data, error } = await supabase.rpc("create_transfer", { p_from: v.fromId, p_to: v.toId, p_amount: v.amountCents, p_date: v.date, p_note: v.note ?? null, p_source: v.source, p_to_amount: v.toAmountCents ?? null });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  done();
  return { ok: true, id: data as string };
}

export async function deleteTransfer(input: unknown): Promise<AccountResult> {
  const p = idSchema.safeParse(input);
  const { x, supabase, user, limited } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (limited) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("delete_transfer", { p_id: p.data.id });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  done();
  return { ok: true };
}

export async function adjustBalance(input: unknown): Promise<AccountResult> {
  const p = adjustSchema.safeParse(input);
  const { x, supabase, user, limited } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (limited) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("adjust_account_balance", { p_account: p.data.accountId, p_target: p.data.targetCents, p_note: p.data.note ?? null });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  done();
  return { ok: true };
}

export async function setFundAccount(input: unknown): Promise<AccountResult> {
  const p = fundSchema.safeParse(input);
  const { x, supabase, user, limited } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (limited) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("set_fund_account", { p_fund: p.data.fundId, p_account: p.data.accountId });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  done();
  return { ok: true };
}

export async function setMovementAccount(input: unknown): Promise<AccountResult> {
  const p = movementSchema.safeParse(input);
  const { x, supabase, user, limited } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (limited) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  if (p.data.accountId && p.data.kind !== "recurring") {
    const { data: m } = await supabase.from(p.data.kind === "expense" ? "expenses" : "incomes").select("*").eq("id", p.data.id).maybeSingle();
    if (m) await warmMovement(supabase, { spaceId: m.space_id, userId: user.id, day: (m.spent_at ?? m.received_at) as string, currency: m.currency, accountId: p.data.accountId });
  }
  const { error } = await supabase.rpc("set_movement_account", { p_kind: p.data.kind, p_id: p.data.id, p_account: p.data.accountId });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  done();
  return { ok: true };
}
