import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addMonths, plannedFor, sumByFund } from "@/lib/money";
import { monthIncome, pendingPaydays } from "@/lib/paydays";
import { sumIn } from "@/server/fx";
import { loadIncomeRules } from "@/server/income-rules";

export type PlanData = {
  month: string;
  plan: { id: string; status: "draft" | "active" | "closed"; notes: string | null } | null;
  members: { id: string; user_id: string | null; display_name: string; role: string }[];
  funds: { id: string; name: string; kind: string; color: string; rollover: boolean; system_key: string | null; linked_space_id?: string | null }[];
  expected: Record<string, number>; // memberId -> previsto
  actual: Record<string, number>; // memberId -> ingresos reales del mes
  allocations: Record<string, { mode: "percent" | "amount"; value: number; planned: number; carry: number }>;
  spentByFund: Record<string, number>;
  uncategorized: number;
  totalSpent: number;
  /** Hay un plan con al menos un fondo asignado. Sin plan no se muestran porcentajes ni rojos. */
  configured: boolean;
  /** Ingreso del mes con el que se reparte y se prevé: incluye los cobros repetidos que aún faltan */
  income: number;
  /** Cobros del mes de los ingresos que se repiten (hechos y por llegar), en la moneda en que se cobran si es una sola */
  paydays: { count: number; cents: number; currency: string; approximate: boolean } | null;
};

/** Datos del plan de un mes: previsto, ingresos reales y gasto por fondo. Todo por RLS. */
export async function loadPlan(supabase: SupabaseClient, spaceId: string, month: string, extraByFund: Record<string, number> = {}, opts: { uncategorizedToDaily?: boolean } = {}): Promise<PlanData> {
  const next = addMonths(month, 1);
  const [{ data: plan }, { data: members }, { data: funds }, { data: cats }, { data: incomes }, { data: expenses }] = await Promise.all([
    supabase.from("monthly_plans").select("id, status, notes, plan_incomes(member_id, expected_cents), plan_allocations(fund_id, mode, value, planned_cents, carry_cents)").eq("space_id", spaceId).eq("month", month).maybeSingle(),
    supabase.from("space_members").select("id, user_id, display_name, role").eq("space_id", spaceId).order("joined_at"),
    supabase.from("funds").select("id, name, kind, color, rollover, system_key, linked_space_id").eq("space_id", spaceId).order("position"),
    supabase.from("categories").select("id, fund_id").eq("space_id", spaceId),
    supabase.from("incomes").select("member_id, amount_cents, currency, original_amount_cents, original_currency, rule_id").eq("space_id", spaceId).gte("received_at", month).lt("received_at", next),
    supabase.from("expenses").select("category_id, amount_base_cents").eq("space_id", spaceId).gte("spent_at", month).lt("spent_at", next).limit(5000),
  ]);
  // Ingresos previstos y asignaciones llegan en la misma consulta del plan (antes eran dos rondas más)
  const pi = (plan as { plan_incomes?: { member_id: string; expected_cents: number }[] } | null)?.plan_incomes ?? [];
  const pa = (plan as { plan_allocations?: { fund_id: string; mode: "percent" | "amount"; value: number; planned_cents: number; carry_cents: number }[] } | null)?.plan_allocations ?? [];

  const catToFund = new Map((cats ?? []).map((c) => [c.id, c.fund_id as string]));
  const sums = sumByFund((expenses ?? []).map((e) => ({ categoryId: e.category_id as string | null, cents: e.amount_base_cents as number })), catToFund);
  const spentByFund: Record<string, number> = {};
  let totalSpent = 0;
  for (const [k, v] of sums) { totalSpent += v; if (k) spentByFund[k] = v; }
  // En la burbuja personal, lo que no tiene categoría cuenta en el fondo "Día a día"
  const daily = opts.uncategorizedToDaily ? (funds ?? []).find((f) => f.system_key === "fund.daily") : undefined;
  if (daily && (sums.get(null) ?? 0) > 0) { spentByFund[daily.id] = (spentByFund[daily.id] ?? 0) + sums.get(null)!; sums.delete(null); }
  for (const [k, v] of Object.entries(extraByFund)) { spentByFund[k] = (spentByFund[k] ?? 0) + v; totalSpent += v; }

  const actual: Record<string, number> = {};
  for (const i of incomes ?? []) actual[i.member_id] = (actual[i.member_id] ?? 0) + i.amount_cents;
  const expected: Record<string, number> = Object.fromEntries(pi.map((r) => [r.member_id, r.expected_cents]));
  const { pending, repeating, paydays } = await loadPaydays(supabase, spaceId, month, incomes ?? []);
  const income = monthIncome((members ?? []).map((m) => m.id), actual, expected, pending, repeating);
  const allocations: PlanData["allocations"] = Object.fromEntries(pa.map((a) => [a.fund_id, { mode: a.mode, value: a.value, planned: a.planned_cents, carry: a.carry_cents }]));
  // Con cobros que se repiten, las partidas por % salen de lo que de verdad entra este mes. Un mes cerrado no se recalcula.
  if (repeating.size > 0 && plan && plan.status !== "closed") {
    for (const p of plannedFor(income, pa.map((a) => ({ fundId: a.fund_id, mode: a.mode, value: a.value })))) {
      if (allocations[p.fundId]!.mode === "percent") allocations[p.fundId]!.planned = p.plannedCents;
    }
  }
  return {
    month, plan: plan ? { id: plan.id, status: plan.status, notes: plan.notes } as PlanData["plan"] : null,
    members: members ?? [], funds: funds ?? [],
    expected, actual, allocations,
    spentByFund, uncategorized: sums.get(null) ?? 0, totalSpent, configured: !!plan && pa.length > 0, income, paydays,
  };
}

type MonthIncomeRow = { member_id: string; amount_cents: number; currency: string; original_amount_cents: number | null; original_currency: string | null; rule_id: string | null };

/** Reglas del espacio, lo que falta por cobrar este mes (en la moneda del espacio) y el recuento de cobros. */
async function loadPaydays(supabase: SupabaseClient, spaceId: string, month: string, incomes: MonthIncomeRow[]) {
  const { rules, skips } = await loadIncomeRules(supabase, spaceId);
  const logged = incomes.filter((i) => i.rule_id);
  const due = rules.flatMap((rule) => pendingPaydays(rule, month, skips).map(() => rule));
  const repeating = new Set<string>([...logged.map((i) => i.member_id), ...due.map((r) => r.memberId)]);
  const pending: Record<string, number> = {};
  if (repeating.size === 0) return { pending, repeating, paydays: null };

  const base = logged[0]?.currency ?? ((await supabase.from("spaces").select("base_currency").eq("id", spaceId).maybeSingle()).data?.base_currency as string);
  let approximate = false;
  for (const member of new Set(due.map((r) => r.memberId))) {
    const sum = await sumIn(base, due.filter((r) => r.memberId === member).map((r) => ({ cents: r.amountCents, currency: r.currency })));
    pending[member] = sum.total;
    approximate ||= sum.approximate || sum.missing;
  }
  // Si todo se cobra en la misma moneda, el total se dice en esa; si no, en la del espacio
  const paid = [
    ...logged.map((i) => ({ cents: i.original_amount_cents ?? i.amount_cents, currency: i.original_currency ?? i.currency, base: i.amount_cents })),
    ...due.map((r) => ({ cents: r.amountCents, currency: r.currency, base: null })),
  ];
  const single = new Set(paid.map((p) => p.currency)).size === 1;
  const cents = single ? paid.reduce((a, p) => a + p.cents, 0)
    : logged.reduce((a, i) => a + i.amount_cents, 0) + Object.values(pending).reduce((a, b) => a + b, 0);
  return { pending, repeating, paydays: { count: paid.length, cents, currency: single ? paid[0]!.currency : base, approximate: !single && approximate } };
}

/** "Tu parte" de gastos de grupo reflejada en el plan personal de este mes, por fondo (solo el propio usuario la ve). */
export async function loadMirrorByFund(supabase: SupabaseClient, month: string): Promise<Record<string, number>> {
  const { data } = await supabase.from("personal_mirror").select("fund_id, amount_cents").eq("enabled", true).gte("spent_at", month).lt("spent_at", addMonths(month, 1)).limit(5000);
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.fund_id] = (out[r.fund_id] ?? 0) + r.amount_cents;
  return out;
}
