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

/** Nº de cobro (0 = el próximo) al que corresponde una fecha proyectada; sirve para saber a quién le toca en un gasto fijo con turnos. */
export function occurrenceNumber(r: Pick<RecurringLite, "frequency" | "nextRun">, dateIso: string): number {
  const a = new Date(`${r.nextRun}T00:00:00Z`), b = new Date(`${dateIso}T00:00:00Z`);
  if (r.frequency === "weekly") return Math.max(0, Math.round((b.getTime() - a.getTime()) / 604800000));
  if (r.frequency === "monthly") return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth());
  return Math.max(0, b.getUTCFullYear() - a.getUTCFullYear());
}
/** Quién paga el cobro nº `n` con turnos: la rotación gira desde la posición guardada. */
export const rotationPayer = (rotation: string[], pos: number, n: number): string | null => (rotation.length > 1 ? rotation[(pos + n) % rotation.length]! : null);

export type UpcomingCharge = { date: string; label: string; cents: number; spaceId: string; kind: "fijo" | "meta" };

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Próximos cobros: todos los de gastos fijos (y pagos de metas) que caen entre hoy y hoy + `days`, por orden de fecha. */
export function upcomingCharges(recurring: (RecurringLite & { spaceId: string })[], milestones: { date: string; label: string; cents: number; spaceId: string }[], todayIso: string, days = 30): UpcomingCharge[] {
  const end = addDaysIso(todayIso, days);
  const out: UpcomingCharge[] = [];
  const first = `${todayIso.slice(0, 7)}-01`;
  const months: string[] = [];
  for (let m = first; m <= end; ) { months.push(m); const d = new Date(`${m}T00:00:00Z`); m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); }
  for (const r of recurring) {
    for (const m of months) for (const date of projectRecurring(r, m)) if (date >= todayIso && date <= end) out.push({ date, label: r.description, cents: r.amountCents, spaceId: r.spaceId, kind: "fijo" });
  }
  for (const m of milestones) if (m.date >= todayIso && m.date <= end) out.push({ ...m, kind: "meta" });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}
