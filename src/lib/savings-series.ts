import { fillSeries } from "@/lib/money";

export type MonthAmounts = { month: string; total_cents: number }[];

/** Calcula el porcentaje por mes; un mes sin ingresos queda sin tasa. */
export function savingsSeries(months: string[], income: MonthAmounts, spend: MonthAmounts, mirror: MonthAmounts = []) {
  const incomes = fillSeries(months, income);
  const expenses = fillSeries(months, spend).map((amount, i) => amount + fillSeries(months, mirror)[i]!);
  return months.map((month, i) => ({
    month,
    income: incomes[i]!,
    spent: expenses[i]!,
    leftover: incomes[i]! - expenses[i]!,
    rateBp: incomes[i]! > 0 ? Math.round(((incomes[i]! - expenses[i]!) / incomes[i]!) * 10000) : null,
  }));
}
