export type RecurringLite = { id: string; description: string; amountCents: number; frequency: "weekly" | "monthly" | "yearly"; day: number; nextRun: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dim = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Fechas (ISO) en las que cae un gasto fijo dentro del mes `monthIso` (YYYY-MM-01), a partir de su próximo cobro. */
export function projectRecurring(r: RecurringLite, monthIso: string): string[] {
  const [y, m] = monthIso.split("-").map(Number) as [number, number];
  const start = Date.UTC(y, m - 1, 1), end = Date.UTC(y, m - 1, dim(y, m - 1));
  const next = Date.parse(`${r.nextRun}T00:00:00Z`);
  const out: string[] = [];
  if (r.frequency === "weekly") {
    let t = next;
    if (t > end) return [];
    if (t < start) t += Math.ceil((start - t) / 604800000) * 604800000;
    for (; t <= end; t += 604800000) out.push(iso(new Date(t)));
  } else if (r.frequency === "monthly") {
    if (next > end) return [];
    out.push(iso(new Date(Date.UTC(y, m - 1, Math.min(r.day, dim(y, m - 1))))));
    if (Date.UTC(y, m - 1, Math.min(r.day, dim(y, m - 1))) < next) return [];
  } else {
    const n = new Date(next);
    if (n.getUTCMonth() === m - 1 && n.getUTCFullYear() <= y) out.push(iso(new Date(Date.UTC(y, m - 1, Math.min(n.getUTCDate(), dim(y, m - 1))))));
  }
  return out;
}
