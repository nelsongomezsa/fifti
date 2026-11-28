import { projectRecurring, type Frequency } from "@/lib/calendar";

/** Cuentas sobre los cobros que se repiten, sin base de datos ni red. */
export type PayFrequency = Exclude<Frequency, "quarterly">;

export const PAY_FREQUENCIES: { id: PayFrequency; label: string }[] = [
  { id: "weekly", label: "Cada semana" }, { id: "biweekly", label: "Cada dos semanas" }, { id: "monthly", label: "Cada mes" }, { id: "yearly", label: "Cada año" },
];

export type IncomeRule = {
  id: string; memberId: string; source: string; amountCents: number; currency: string; accountId: string | null;
  frequency: PayFrequency; day: number; nextRun: string; active: boolean;
};

/** Cobros de una regla que aún no se han apuntado y caen en el mes (YYYY-MM-01), sin los saltados. */
export function pendingPaydays(rule: IncomeRule, month: string, skips: ReadonlySet<string> = new Set()): string[] {
  if (!rule.active) return [];
  return projectRecurring({ id: rule.id, description: rule.source, amountCents: rule.amountCents, frequency: rule.frequency, day: rule.day, nextRun: rule.nextRun }, month)
    .filter((date) => date >= rule.nextRun && !skips.has(`${rule.id}|${date}`));
}

/** Ingreso del mes para repartir: quien tiene cobros que se repiten, lo cobrado más lo que falta; el resto, lo real o lo previsto. */
export function monthIncome(members: readonly string[], actual: Record<string, number>, expected: Record<string, number>, pending: Record<string, number>, repeating: ReadonlySet<string>): number {
  if (repeating.size === 0) {
    const real = Object.values(actual).reduce((a, b) => a + b, 0);
    return real > 0 ? real : Object.values(expected).reduce((a, b) => a + b, 0);
  }
  return members.reduce((total, id) => total + (repeating.has(id) ? (actual[id] ?? 0) + (pending[id] ?? 0) : (actual[id] ?? 0) > 0 ? actual[id]! : (expected[id] ?? 0)), 0);
}

/** Lunes = 1 … domingo = 7. */
export const isoWeekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
