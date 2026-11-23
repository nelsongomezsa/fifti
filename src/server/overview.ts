import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addMonths, fillSeries, forecastMonthEnd, lastMonths, monthChange, monthStart, savingsRateBp, summarizeFund, type FundRow } from "@/lib/money";
import { loadMirrorByFund, loadPlan, type PlanData } from "./plan";

export type Overview = {
  month: string;
  income: number;
  spent: number;
  leftover: number;
  prevLeftover: number;
  change: { deltaCents: number; percentBp: number | null };
  savingsBp: number;
  forecastLeftover: number;
  series: { label: string; cents: number; current: boolean }[];
  funds: (FundRow & { name: string; color: string })[];
  plan: PlanData;
};

async function seriesFor(supabase: SupabaseClient, spaceId: string, personal: boolean, from: string) {
  const [{ data: spend }, { data: inc }, { data: mir }] = await Promise.all([
    supabase.rpc("monthly_spend", { p_space: spaceId, p_from: from }),
    supabase.rpc("monthly_income", { p_space: spaceId, p_from: from }),
    personal ? supabase.rpc("monthly_mirror", { p_from: from }) : Promise.resolve({ data: [] }),
  ]);
  return { spend: (spend ?? []) as { month: string; total_cents: number }[], inc: (inc ?? []) as { month: string; total_cents: number }[], mir: (mir ?? []) as { month: string; total_cents: number }[] };
}

/** Panel de Inicio / seguimiento de un mes: sobra, tasa de ahorro, previsión y gasto de 6 meses. */
export async function loadOverview(supabase: SupabaseClient, spaceId: string, kind: "personal" | "household" | "group", month = monthStart(new Date()), today = new Date().toISOString().slice(0, 10), locale = "es-ES"): Promise<Overview> {
  const personal = kind === "personal";
  const mirror = personal ? await loadMirrorByFund(supabase, month) : {};
  const plan = await loadPlan(supabase, spaceId, month, mirror);
  const months = lastMonths(month, 6);
  const s = await seriesFor(supabase, spaceId, personal, months[0]!);
  const spendSeries = fillSeries(months, s.spend).map((v, i) => v + fillSeries(months, s.mir)[i]!);
  const incSeries = fillSeries(months, s.inc);

  const expectedTotal = Object.values(plan.expected).reduce((a, b) => a + b, 0);
  const actualTotal = Object.values(plan.actual).reduce((a, b) => a + b, 0);
  const income = actualTotal > 0 ? actualTotal : expectedTotal;
  const spent = plan.totalSpent;
  const prevIncome = incSeries[4]! > 0 ? incSeries[4]! : 0;
  const prevLeftover = prevIncome - spendSeries[4]!;
  const leftover = income - spent;

  const funds = plan.funds.map((f) => ({
    ...summarizeFund(f.id, (plan.allocations[f.id]?.planned ?? 0) + (plan.allocations[f.id]?.carry ?? 0), plan.spentByFund[f.id] ?? 0),
    name: f.name, color: f.color, kind: f.kind,
  }));
  const fixed = funds.filter((f) => f.kind === "fixed");
  const spentFixed = fixed.reduce((a, f) => a + f.spent, 0);
  const forecast = forecastMonthEnd({
    monthIso: month, today, spentVariable: spent - spentFixed, spentFixed, plannedFixed: fixed.reduce((a, f) => a + f.planned, 0), income,
  });
  const label = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString(locale, { month: "short", timeZone: "UTC" }).replace(".", "");
  return {
    month, income, spent, leftover, prevLeftover, change: monthChange(leftover, prevLeftover), savingsBp: savingsRateBp(income, spent),
    forecastLeftover: forecast.projectedLeftover,
    series: months.map((m, i) => ({ label: label(m), cents: spendSeries[i]!, current: m === month })),
    funds, plan,
  };
}

export { addMonths };
