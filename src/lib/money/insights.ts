import { addMonths } from "./months";
import { BP_TOTAL, type BasisPoints, type Cents } from "./types";

/** Tasa de ahorro = (ingresos − gasto) / ingresos, en puntos básicos. Puede ser negativa; 0 si no hay ingresos. */
export function savingsRateBp(income: Cents, spent: Cents): BasisPoints {
  return income > 0 ? Math.round(((income - spent) * BP_TOTAL) / income) : 0;
}

/** Variación frente al mes anterior. `percentBp` es null si el anterior era 0. */
export function monthChange(current: Cents, previous: Cents): { deltaCents: Cents; percentBp: BasisPoints | null } {
  return { deltaCents: current - previous, percentBp: previous !== 0 ? Math.round(((current - previous) * BP_TOTAL) / Math.abs(previous)) : null };
}

/** Los últimos `n` meses terminando en `monthIso`, del más antiguo al más reciente. */
export function lastMonths(monthIso: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(monthIso, i - (n - 1)));
}

/** Rellena con ceros los meses sin datos. */
export function fillSeries(months: readonly string[], rows: readonly { month: string; total_cents: number }[]): Cents[] {
  const m = new Map(rows.map((r) => [r.month, Number(r.total_cents)]));
  return months.map((x) => m.get(x) ?? 0);
}

/** Sobrante de un fondo al cerrar el mes: previsto (+ arrastre) − gastado. */
export const fundLeftover = (planned: Cents, carry: Cents, spent: Cents): Cents => planned + carry - spent;
