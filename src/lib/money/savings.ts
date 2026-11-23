import { applyBasisPoints } from "./allocate";
import { BP_TOTAL, type BasisPoints, type Cents } from "./types";

export type GoalProgress = { contributed: Cents; available: Cents; remaining: Cents; pctBp: BasisPoints; unpaidMilestones: Cents };

/** Progreso de una meta. Los hitos pagados (proveedores) salen del dinero disponible. */
export function goalProgress(target: Cents, contributed: Cents, milestones: readonly { amountCents: Cents; paid: boolean }[] = []): GoalProgress {
  const paid = milestones.filter((m) => m.paid).reduce((a, b) => a + b.amountCents, 0);
  return {
    contributed, available: contributed - paid, remaining: Math.max(0, target - contributed),
    pctBp: target > 0 ? Math.min(BP_TOTAL, Math.round((contributed * BP_TOTAL) / target)) : 0,
    unpaidMilestones: milestones.filter((m) => !m.paid).reduce((a, b) => a + b.amountCents, 0),
  };
}

/** Meses naturales (≥ 1) entre hoy y la fecha límite, contando el mes en curso. */
export function monthsUntil(deadlineIso: string, todayIso: string): number {
  const [dy, dm] = deadlineIso.split("-").map(Number) as [number, number];
  const [ty, tm] = todayIso.split("-").map(Number) as [number, number];
  return Math.max(1, (dy - ty) * 12 + (dm - tm) + 1);
}

/** Cuánto ahorrar cada mes para llegar a la meta a tiempo (redondeado hacia arriba). */
export function monthlyNeeded(remaining: Cents, deadlineIso: string | null, todayIso: string): Cents {
  if (!deadlineIso || remaining <= 0) return 0;
  return Math.ceil(remaining / monthsUntil(deadlineIso, todayIso));
}

/** Redondeo: lo que falta para llegar al siguiente múltiplo de `step` (0 si ya es exacto). */
export function roundUpCents(amount: Cents, step: Cents = 100): Cents {
  if (!Number.isInteger(step) || step <= 0) throw new RangeError("El paso del redondeo debe ser > 0");
  const r = amount % step;
  return r === 0 ? 0 : step - r;
}

/** % de cada ingreso que va a la meta. */
export const percentOfIncome = (income: Cents, bp: BasisPoints): Cents => applyBasisPoints(income, bp);

/** Reto de las 52 semanas: la semana k se ahorra k × paso. */
export function challenge52(step: Cents = 100): { week: number; amountCents: Cents; cumulativeCents: Cents }[] {
  let cum = 0;
  return Array.from({ length: 52 }, (_, i) => {
    cum += (i + 1) * step;
    return { week: i + 1, amountCents: (i + 1) * step, cumulativeCents: cum };
  });
}
