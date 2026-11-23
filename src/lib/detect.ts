export type ExpenseLite = { description: string; amountCents: number; spentAt: string };
export type SubscriptionCandidate = { description: string; amountCents: number; day: number; months: number };

/** Normaliza el concepto: minúsculas, sin números ni signos ("Netflix 11/2026" y "NETFLIX" coinciden). */
export const normalizeConcept = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Detecta cobros que se repiten cada mes con concepto e importe parecidos (±10 %) en ≥ 3 meses seguidos.
 * `known` son los conceptos que ya son gasto fijo (se omiten).
 */
export function detectSubscriptions(expenses: readonly ExpenseLite[], known: readonly string[] = []): SubscriptionCandidate[] {
  const knownSet = new Set(known.map(normalizeConcept));
  const groups = new Map<string, ExpenseLite[]>();
  for (const e of expenses) {
    const k = normalizeConcept(e.description);
    if (k.length < 3 || knownSet.has(k)) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  const out: SubscriptionCandidate[] = [];
  for (const list of groups.values()) {
    const byMonth = new Map<string, ExpenseLite>();
    for (const e of list) byMonth.set(e.spentAt.slice(0, 7), e);
    const months = [...byMonth.keys()].sort();
    // racha más larga de meses consecutivos con importe parecido
    let best: ExpenseLite[] = [], run: ExpenseLite[] = [];
    for (const m of months) {
      const e = byMonth.get(m)!;
      const prevMonth = run.length ? run[run.length - 1]!.spentAt.slice(0, 7) : null;
      const consecutive = prevMonth !== null && nextMonth(prevMonth) === m;
      const similar = run.length === 0 || Math.abs(e.amountCents - run[run.length - 1]!.amountCents) <= run[run.length - 1]!.amountCents * 0.1;
      run = consecutive && similar ? [...run, e] : [e];
      if (run.length > best.length) best = run;
    }
    if (best.length >= 3) {
      const amounts = best.map((e) => e.amountCents).sort((a, b) => a - b);
      out.push({
        description: best[best.length - 1]!.description, amountCents: amounts[Math.floor(amounts.length / 2)]!,
        day: Number(best[best.length - 1]!.spentAt.slice(8, 10)), months: best.length,
      });
    }
  }
  return out.sort((a, b) => b.months - a.months || b.amountCents - a.amountCents);
}
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
