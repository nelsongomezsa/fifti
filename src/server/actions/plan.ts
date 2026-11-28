"use server";

import { getTx } from "@/i18n/tx";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { MAX_AMOUNT_CENTS, addMonths, contributionTargets, isMonthStart, parseToCents, plannedFor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { parsePercentToBp, uuidSchema } from "@/lib/validation/spaces";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { rpcMessage } from "@/server/rpc-error";
import { warmContribution } from "@/server/currency-warm";
import type { FormState } from "./auth";

const month = z.string().refine(isMonthStart, "Mes no válido");
const field = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
async function ctx() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function savePlan(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const spaceId = uuidSchema.safeParse(field(fd, "spaceId"));
  const m = month.safeParse(field(fd, "month"));
  if (!spaceId.success || !m.success) return { error: x("Datos no válidos") };
  const incomes: { member_id: string; expected_cents: number }[] = [];
  const allocs: { fundId: string; mode: "percent" | "amount"; value: number }[] = [];
  for (const [key, raw] of fd.entries()) {
    if (typeof raw !== "string") continue;
    if (key.startsWith("inc_")) {
      const id = uuidSchema.safeParse(key.slice(4));
      const c = raw.trim() === "" ? 0 : parseToCents(raw);
      if (!id.success || c === null || c > MAX_AMOUNT_CENTS) return { error: x("Importe de ingreso no válido") };
      incomes.push({ member_id: id.data, expected_cents: c });
    } else if (key.startsWith("val_")) {
      const id = uuidSchema.safeParse(key.slice(4));
      const mode = field(fd, `mode_${key.slice(4)}`) === "amount" ? "amount" : "percent";
      if (!id.success || raw.trim() === "") continue;
      const v = mode === "percent" ? parsePercentToBp(raw) : parseToCents(raw);
      if (v === null || v > MAX_AMOUNT_CENTS) return { error: x("Valor de fondo no válido") };
      allocs.push({ fundId: id.data, mode, value: v });
    }
  }
  let planned;
  try {
    planned = plannedFor(incomes.reduce((a, b) => a + b.expected_cents, 0), allocs);
  } catch (e) {
    return { error: x(e instanceof RangeError ? e.message : "Datos no válidos") };
  }
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { error } = await supabase.rpc("save_plan", {
    p: {
      space_id: spaceId.data, month: m.data, notes: field(fd, "notes").slice(0, 500) || null, incomes,
      allocations: allocs.map((a, i) => ({ fund_id: a.fundId, mode: a.mode, value: a.value, planned_cents: planned[i]!.plannedCents })),
    },
  });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/plan");
  return { ok: true, message: x("Plan guardado.") };
}

export async function copyPreviousPlan(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const spaceId = uuidSchema.safeParse(field(fd, "spaceId"));
  const m = month.safeParse(field(fd, "month"));
  if (!spaceId.success || !m.success) return { error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { error } = await supabase.rpc("copy_plan", { p_space: spaceId.data, p_from: addMonths(m.data, -1), p_to: m.data });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/plan");
  return { ok: true, message: x("Plan copiado del mes anterior.") };
}

const recurringSchema = z
  .object({
    spaceId: z.uuid(), id: z.uuid().optional(), description: z.string().trim().min(1).max(120),
    amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS), frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    day: z.number().int().min(1).max(31), nextRun: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), categoryId: z.uuid().nullable(),
    paidFrom: z.enum(["member", "pot"]), detected: z.boolean().default(false), rotation: z.array(z.uuid()).max(8).default([]), accountId: z.uuid().nullable().optional(),
  })
  .strict();

export async function saveRecurring(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = recurringSchema.safeParse({
    spaceId: field(fd, "spaceId"), id: field(fd, "id") || undefined, description: field(fd, "description"),
    accountId: fd.has("accountId") ? (field(fd, "accountId") || null) : undefined,
    amountCents: parseToCents(field(fd, "amount")) ?? 0, frequency: field(fd, "frequency") || "monthly",
    day: Number(field(fd, "day") || "1"), nextRun: field(fd, "nextRun"), categoryId: field(fd, "categoryId") || null,
    paidFrom: field(fd, "paidFrom") === "pot" ? "pot" : "member", detected: field(fd, "detected") === "1",
    rotation: field(fd, "turns") === "1"
      ? [...fd.entries()].filter(([k, v]) => k.startsWith("turn_") && typeof v === "string" && /^[1-8]$/.test(v)).sort((a, b) => Number(a[1]) - Number(b[1])).map(([k]) => k.slice(5))
      : [],
  });
  if (!parsed.success) return { error: x(parsed.error.issues[0]?.message ?? "Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  if (!(await allow(RULES.planWrites, user.id))) return { error: x("Demasiados intentos. Espera un rato.") };
  const v = parsed.data;
  const { data: recId, error } = await supabase.rpc("save_recurring", {
    p: { id: v.id ?? null, space_id: v.spaceId, description: v.description, amount_cents: v.amountCents, frequency: v.frequency, day: v.day, next_run: v.nextRun, category_id: v.categoryId, paid_from: v.paidFrom, detected: v.detected, rotation: v.rotation },
  });
  if (error) return { error: x(rpcMessage(error)) };
  if (v.accountId !== undefined) {
    const acc = await supabase.rpc("set_movement_account", { p_kind: "recurring", p_id: (recId as string) ?? v.id, p_account: v.accountId });
    if (acc.error) return { error: x(rpcMessage(acc.error)) };
  }
  revalidatePath("/plan");
  revalidatePath("/calendario");
  return { ok: true, message: x("Gasto fijo guardado.") };
}

/** Borrar desde la pantalla de edición: redirige desde el servidor, o devuelve el error sin moverse. */
export async function deleteRecurringAndGo(id: string): Promise<{ ok: false; error: string }> {
  const x = await getTx();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.deletes, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("delete_recurring", { p_id: id });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/plan");
  revalidatePath("/calendario");
  redirect("/plan?vista=fijos&borrado=1", RedirectType.replace);
}

export async function saveContributionRule(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const spaceId = uuidSchema.safeParse(field(fd, "spaceId"));
  const mode = z.enum(["proportional_to_income", "fixed_percent", "fixed_amount"]).safeParse(field(fd, "mode"));
  const target = parseToCents(field(fd, "target") || "0");
  if (!spaceId.success || !mode.success || target === null) return { error: x("Datos no válidos") };
  const values: Record<string, number> = {};
  for (const [k, raw] of fd.entries()) {
    if (!k.startsWith("rv_") || typeof raw !== "string" || raw.trim() === "") continue;
    const id = uuidSchema.safeParse(k.slice(3));
    const v = mode.data === "fixed_percent" ? parsePercentToBp(raw) : parseToCents(raw);
    if (!id.success || v === null) return { error: x("Valor no válido") };
    values[id.data] = v;
  }
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { error } = await supabase.rpc("save_contribution_rule", { p_space: spaceId.data, p_mode: mode.data, p_target: target, p_values: values });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/plan");
  return { ok: true, message: x("Regla guardada.") };
}

/** Genera las aportaciones previstas del mes a partir de la regla y los ingresos previstos del plan. */
export async function generateContributions(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const spaceId = uuidSchema.safeParse(field(fd, "spaceId"));
  const m = month.safeParse(field(fd, "month"));
  if (!spaceId.success || !m.success) return { error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const [{ data: rule }, { data: members }, { data: plan }] = await Promise.all([
    supabase.from("contribution_rules").select("mode, monthly_target_cents, values").eq("space_id", spaceId.data).maybeSingle(),
    supabase.from("space_members").select("id").eq("space_id", spaceId.data),
    supabase.from("monthly_plans").select("id").eq("space_id", spaceId.data).eq("month", m.data).maybeSingle(),
  ]);
  if (!rule) return { error: x("Define primero la regla de aportación.") };
  const { data: pi } = plan ? await supabase.from("plan_incomes").select("member_id, expected_cents").eq("plan_id", plan.id) : { data: [] };
  try {
    const lines = contributionTargets(rule.mode, rule.monthly_target_cents, (members ?? []).map((mm) => ({
      memberId: mm.id, incomeCents: pi?.find((i) => i.member_id === mm.id)?.expected_cents ?? 0,
    })), rule.values as Record<string, number>);
    const { error } = await supabase.rpc("save_contributions", {
      p_space: spaceId.data, p_month: m.data, p_lines: lines.map((l) => ({ member_id: l.memberId, expected_cents: l.expectedCents })),
    });
    if (error) return { error: x(rpcMessage(error)) };
  } catch (e) {
    return { error: x(e instanceof RangeError ? e.message : "No se han podido calcular las aportaciones.") };
  }
  revalidatePath("/plan");
  return { ok: true, message: x("Aportaciones del mes calculadas.") };
}

export async function markContributionPaid(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const id = uuidSchema.safeParse(field(fd, "contributionId"));
  const paid = parseToCents(field(fd, "paid") || "0");
  if (!id.success || paid === null) return { error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { data: row } = await supabase.from("contributions").select("space_id").eq("id", id.data).maybeSingle();
  if (row) await warmContribution(supabase, row.space_id);
  const { error } = await supabase.rpc("mark_contribution_paid", { p_id: id.data, p_paid: paid });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/plan");
  return { ok: true, message: x(paid > 0 ? "Aportación marcada como hecha." : "Aportación desmarcada.") };
}

export async function closePlan(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const { loadPlan, loadMirrorByFund } = await import("@/server/plan");
  const { fundLeftover } = await import("@/lib/money");
  const spaceId = uuidSchema.safeParse(field(fd, "spaceId"));
  const m = month.safeParse(field(fd, "month"));
  if (!spaceId.success || !m.success) return { error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { data: space } = await supabase.from("spaces").select("kind").eq("id", spaceId.data).maybeSingle();
  if (!space) return { error: x("No autorizado.") };
  // El sobrante se recalcula en el servidor: el cliente solo elige qué hacer con él.
  const plan = await loadPlan(supabase, spaceId.data, m.data, space.kind === "personal" ? await loadMirrorByFund(supabase, m.data) : {});
  const decisions = plan.funds.map((f) => {
    const a = plan.allocations[f.id];
    const leftover = fundLeftover(a?.planned ?? 0, a?.carry ?? 0, plan.spentByFund[f.id] ?? 0);
    const raw = field(fd, `act_${f.id}`);
    const goal = raw.startsWith("goal:") ? uuidSchema.safeParse(raw.slice(5)) : null;
    const action = goal?.success ? "goal" : raw === "rollover" ? "rollover" : "free";
    return { fund_id: f.id, action, goal_id: goal?.success ? goal.data : null, leftover_cents: leftover };
  });
  const { error } = await supabase.rpc("close_plan", { p_space: spaceId.data, p_month: m.data, p_decisions: decisions });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/plan");
  return { ok: true, message: x("Mes cerrado. Queda en solo lectura.") };
}

export async function reopenPlan(fd: FormData) {
  const spaceId = uuidSchema.safeParse(field(fd, "spaceId"));
  const m = month.safeParse(field(fd, "month"));
  if (!spaceId.success || !m.success) return;
  const { supabase, user } = await ctx();
  if (!user) return;
  await supabase.rpc("reopen_plan", { p_space: spaceId.data, p_month: m.data });
  revalidatePath("/plan");
}

export async function setMirrorPref(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const spaceId = uuidSchema.safeParse(field(fd, "spaceId"));
  const fund = field(fd, "fundId");
  const fundId = fund ? uuidSchema.safeParse(fund) : null;
  if (!spaceId.success || (fundId && !fundId.success)) return { error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { error } = await supabase.rpc("set_mirror_pref", { p_space: spaceId.data, p_enabled: field(fd, "enabled") === "on", p_fund: fundId?.success ? fundId.data : null });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  return { ok: true, message: x("Guardado.") };
}

const skipSchema = z.object({ recurringId: z.uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), skip: z.boolean() }).strict();

/** «Saltar este mes»: solo esa ocurrencia del gasto fijo (o volver a activarla). */
export async function setRecurringSkip(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const x = await getTx();
  const p = skipSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.planWrites, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.rpc("set_recurring_skip", { p_recurring: p.data.recurringId, p_date: p.data.date, p_skip: p.data.skip });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/calendario");
  return { ok: true };
}
