/** Presupuesto semanal: lo que queda del gasto variable del plan, repartido por los días que faltan del mes. Funciones puras. */
export type PlanFund = { kind: string; planned: number; spent: number };
export type WeeklyBudget = { leftCents: number; usedBp: number; status: "ok" | "warn" | "over"; daysInWeek: number; daysInMonth: number };

/** Fondos de gasto del día a día; los fijos, el ahorro, la inversión, los imprevistos y la aportación no cuentan. */
export const VARIABLE_KINDS = ["variable", "leisure", "other"] as const;

export function weeklyBudget(funds: PlanFund[], todayIso: string): WeeklyBudget | null {
  const v = funds.filter((f) => (VARIABLE_KINDS as readonly string[]).includes(f.kind));
  const planned = v.reduce((a, f) => a + f.planned, 0);
  if (planned <= 0) return null; // sin plan para gasto variable no hay presupuesto que enseñar
  const spent = v.reduce((a, f) => a + f.spent, 0);
  const d = new Date(`${todayIso}T00:00:00Z`);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const daysInMonth = dim - d.getUTCDate() + 1; // contando hoy
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // lunes = 1 … domingo = 7
  const daysInWeek = Math.min(8 - isoDow, daysInMonth); // hoy hasta el domingo (o hasta fin de mes)
  const remaining = planned - spent;
  const usedBp = Math.round((spent * 10000) / planned);
  const leftCents = remaining > 0 ? Math.round((remaining * daysInWeek) / daysInMonth) : remaining;
  return { leftCents, usedBp, status: remaining <= 0 ? "over" : usedBp >= 8000 ? "warn" : "ok", daysInWeek, daysInMonth };
}
