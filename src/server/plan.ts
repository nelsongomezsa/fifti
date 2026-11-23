import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addMonths, sumByFund } from "@/lib/money";

export type PlanData = {
  month: string;
  plan: { id: string; status: "draft" | "active" | "closed"; notes: string | null } | null;
  members: { id: string; user_id: string | null; display_name: string; role: string }[];
  funds: { id: string; name: string; kind: string; color: string; rollover: boolean; system_key: string | null }[];
  expected: Record<string, number>; // memberId -> previsto
  actual: Record<string, number>; // memberId -> ingresos reales del mes
  allocations: Record<string, { mode: "percent" | "amount"; value: number; planned: number; carry: number }>;
  spentByFund: Record<string, number>;
  uncategorized: number;
  totalSpent: number;
};

/** Datos del plan de un mes: previsto, ingresos reales y gasto por fondo. Todo por RLS. */
export async function loadPlan(supabase: SupabaseClient, spaceId: string, month: string, extraByFund: Record<string, number> = {}): Promise<PlanData> {
  const next = addMonths(month, 1);
  const [{ data: plan }, { data: members }, { data: funds }, { data: cats }, { data: incomes }, { data: expenses }] = await Promise.all([
    supabase.from("monthly_plans").select("id, status, notes, plan_incomes(member_id, expected_cents), plan_allocations(fund_id, mode, value, planned_cents, carry_cents)").eq("space_id", spaceId).eq("month", month).maybeSingle(),
    supabase.from("space_members").select("id, user_id, display_name, role").eq("space_id", spaceId).order("joined_at"),
    supabase.from("funds").select("id, name, kind, color, rollover, system_key").eq("space_id", spaceId).order("position"),
    supabase.from("categories").select("id, fund_id").eq("space_id", spaceId),
    supabase.from("incomes").select("member_id, amount_cents").eq("space_id", spaceId).gte("received_at", month).lt("received_at", next),
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
  for (const [k, v] of Object.entries(extraByFund)) { spentByFund[k] = (spentByFund[k] ?? 0) + v; totalSpent += v; }

  const actual: Record<string, number> = {};
  for (const i of incomes ?? []) actual[i.member_id] = (actual[i.member_id] ?? 0) + i.amount_cents;
  return {
    month, plan: plan ? { id: plan.id, status: plan.status, notes: plan.notes } as PlanData["plan"] : null,
    members: members ?? [], funds: funds ?? [],
    expected: Object.fromEntries(pi.map((r) => [r.member_id, r.expected_cents])),
    actual,
    allocations: Object.fromEntries(pa.map((a) => [a.fund_id, { mode: a.mode, value: a.value, planned: a.planned_cents, carry: a.carry_cents }])),
    spentByFund, uncategorized: sums.get(null) ?? 0, totalSpent,
  };
}

/** "Tu parte" de gastos de grupo reflejada en el plan personal de este mes, por fondo (solo el propio usuario la ve). */
export async function loadMirrorByFund(supabase: SupabaseClient, month: string): Promise<Record<string, number>> {
  const { data } = await supabase.from("personal_mirror").select("fund_id, amount_cents").eq("enabled", true).gte("spent_at", month).lt("spent_at", addMonths(month, 1)).limit(5000);
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.fund_id] = (out[r.fund_id] ?? 0) + r.amount_cents;
  return out;
}
