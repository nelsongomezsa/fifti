import { allocate, applyBasisPoints } from "./allocate";
import { BP_TOTAL, type BasisPoints, type Cents } from "./types";

export type AllocationInput = { fundId: string; mode: "percent" | "amount"; value: number };
export type FundStatus = "ok" | "warn" | "over";

/**
 * Importe previsto por fondo. Los fondos por % reparten `base × suma%` con mayor resto (la suma es exacta);
 * los fondos por importe usan el valor tal cual.
 */
export function plannedFor(base: Cents, items: readonly AllocationInput[]): { fundId: string; plannedCents: Cents }[] {
  const pct = items.filter((i) => i.mode === "percent");
  const sumBp = pct.reduce((a, b) => a + b.value, 0);
  if (sumBp > BP_TOTAL) throw new RangeError("Los porcentajes superan el 100 %");
  const pctTotal = applyBasisPoints(base, sumBp);
  const pctAmounts = pct.length && sumBp > 0 ? allocate(pctTotal, pct.map((p) => p.value)) : pct.map(() => 0);
  const byFund = new Map(pct.map((p, i) => [p.fundId, pctAmounts[i]!]));
  return items.map((i) => ({ fundId: i.fundId, plannedCents: i.mode === "percent" ? byFund.get(i.fundId)! : i.value }));
}

/** Avisos al 80 % (warn) y al 100 % (over). */
export function fundStatus(planned: Cents, spent: Cents): FundStatus {
  if (planned <= 0) return spent > 0 ? "over" : "ok";
  const usedBp = (spent * BP_TOTAL) / planned;
  if (usedBp >= BP_TOTAL) return "over";
  if (usedBp >= 8000) return "warn";
  return "ok";
}

export type FundRow = { fundId: string; planned: Cents; spent: Cents; remaining: Cents; usedBp: BasisPoints; status: FundStatus };

export function summarizeFund(fundId: string, planned: Cents, spent: Cents): FundRow {
  return {
    fundId, planned, spent, remaining: planned - spent,
    usedBp: planned > 0 ? Math.round((spent * BP_TOTAL) / planned) : spent > 0 ? BP_TOTAL : 0,
    status: fundStatus(planned, spent),
  };
}

export function daysInMonth(monthIso: string): number {
  const [y, m] = monthIso.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export type Forecast = { spentSoFar: Cents; projectedSpend: Cents; projectedLeftover: Cents; dailyRate: Cents };

/**
 * Previsión de fin de mes: ritmo del gasto variable hasta hoy extrapolado al mes completo + gastos fijos
 * (lo ya gastado o, si falta por pagar, lo previsto). `today` es una fecha ISO; si el mes ya pasó usa el mes entero.
 */
export function forecastMonthEnd(p: {
  monthIso: string; today: string; spentVariable: Cents; spentFixed: Cents; plannedFixed: Cents; income: Cents;
}): Forecast {
  const dim = daysInMonth(p.monthIso);
  const monthEnd = `${p.monthIso.slice(0, 8)}${String(dim).padStart(2, "0")}`;
  let elapsed: number;
  if (p.today < p.monthIso) elapsed = 0;
  else if (p.today > monthEnd) elapsed = dim;
  else elapsed = Number(p.today.slice(8, 10));
  const dailyRate = elapsed > 0 ? Math.round(p.spentVariable / elapsed) : 0;
  const projectedVariable = elapsed >= dim ? p.spentVariable : elapsed === 0 ? 0 : Math.round((p.spentVariable * dim) / elapsed);
  const fixed = Math.max(p.spentFixed, p.plannedFixed);
  const projectedSpend = projectedVariable + fixed;
  return { spentSoFar: p.spentVariable + p.spentFixed, projectedSpend, projectedLeftover: p.income - projectedSpend, dailyRate };
}

export type ContributionMode = "proportional_to_income" | "fixed_percent" | "fixed_amount";

/** Aportación prevista de cada miembro al bote común según la regla. */
export function contributionTargets(
  mode: ContributionMode, target: Cents, members: readonly { memberId: string; incomeCents: Cents }[], values: Readonly<Record<string, number>> = {},
): { memberId: string; expectedCents: Cents }[] {
  if (members.length === 0) return [];
  if (mode === "fixed_amount") {
    return members.map((m) => {
      const v = values[m.memberId] ?? 0;
      if (!Number.isSafeInteger(v) || v < 0) throw new RangeError("Importe fijo no válido");
      return { memberId: m.memberId, expectedCents: v };
    });
  }
  let weights: number[];
  if (mode === "fixed_percent") {
    weights = members.map((m) => values[m.memberId] ?? 0);
    if (weights.reduce((a, b) => a + b, 0) !== BP_TOTAL) throw new RangeError("Los porcentajes deben sumar 100 %");
  } else {
    weights = members.map((m) => m.incomeCents);
    if (weights.reduce((a, b) => a + b, 0) === 0) weights = members.map(() => 1);
  }
  const amounts = allocate(target, weights);
  return members.map((m, i) => ({ memberId: m.memberId, expectedCents: amounts[i]! }));
}

/** Saldo del bote = aportaciones hechas − gastos pagados desde el bote. */
export function potBalance(paidContributions: readonly Cents[], potExpenses: readonly Cents[]): Cents {
  return paidContributions.reduce((a, b) => a + b, 0) - potExpenses.reduce((a, b) => a + b, 0);
}

/** Gasto por fondo a partir de gastos con categoría. Lo que no tiene categoría va a `null`. */
export function sumByFund(
  expenses: readonly { categoryId: string | null; cents: Cents }[],
  categoryToFund: ReadonlyMap<string, string>,
): Map<string | null, Cents> {
  const out = new Map<string | null, Cents>();
  for (const e of expenses) {
    const fund = e.categoryId ? (categoryToFund.get(e.categoryId) ?? null) : null;
    out.set(fund, (out.get(fund) ?? 0) + e.cents);
  }
  return out;
}

export type OutlookFund = { kind: string; planned: Cents; spent: Cents };
export type MonthOutlook = { income: Cents; spent: Cents; pendingFixed: Cents; pendingVariable: Cents; projectedLeftover: Cents };

/**
 * Previsión realista de fin de mes (la misma en Inicio, Plan y su detalle):
 * ingresos − gastado − lo que queda previsto de gastos fijos − lo que queda previsto de gasto variable.
 * El ahorro, la inversión, los imprevistos y la aportación no son gastos: no restan.
 */
export function monthOutlook(income: Cents, spentTotal: Cents, funds: readonly OutlookFund[]): MonthOutlook {
  const left = (f: OutlookFund) => Math.max(0, f.planned - f.spent);
  const pendingFixed = funds.filter((f) => f.kind === "fixed").reduce((a, f) => a + left(f), 0);
  const pendingVariable = funds.filter((f) => ["variable", "leisure", "other"].includes(f.kind)).reduce((a, f) => a + left(f), 0);
  return { income, spent: spentTotal, pendingFixed, pendingVariable, projectedLeftover: income - spentTotal - pendingFixed - pendingVariable };
}

/** Tasa de ahorro PREVISTA del plan: lo que va a fondos de ahorro entre los ingresos del mes (puntos básicos, 0 si no hay ingresos). */
export function plannedSavingsBp(income: Cents, funds: readonly OutlookFund[]): number {
  if (income <= 0) return 0;
  const saved = funds.filter((f) => f.kind === "savings").reduce((a, f) => a + f.planned, 0);
  return Math.max(0, Math.min(10000, Math.round((saved * 10000) / income)));
}
