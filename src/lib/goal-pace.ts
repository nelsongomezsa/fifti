/** Evolución y ritmo de una meta de ahorro. Funciones puras. */
export type Contribution = { date: string; cents: number };
export type GoalPace = {
  series: { date: string; totalCents: number }[];
  avgPerMonthCents: number;
  /** Fecha estimada de llegada al ritmo medio; null si no hay ritmo o ya se alcanzó */
  etaDate: string | null;
  reached: boolean;
};

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function goalPace(contribs: Contribution[], targetCents: number, todayIso: string): GoalPace {
  const sorted = [...contribs].sort((a, b) => a.date.localeCompare(b.date));
  let acc = 0;
  const series = sorted.map((c) => ({ date: c.date, totalCents: (acc += c.cents) }));
  const total = acc;
  const reached = targetCents > 0 && total >= targetCents;
  if (sorted.length === 0) return { series, avgPerMonthCents: 0, etaDate: null, reached: false };
  // Ritmo: lo aportado entre la primera aportación y hoy, en meses de 30 días (mínimo 1 mes para no disparar la media)
  const first = Date.parse(`${sorted[0]!.date}T00:00:00Z`), today = Date.parse(`${todayIso}T00:00:00Z`);
  const months = Math.max(1, (today - first) / (30 * DAY));
  const avgPerMonthCents = Math.round(total / months);
  const etaDate = reached || avgPerMonthCents <= 0 ? null : iso(today + Math.ceil(((targetCents - total) / avgPerMonthCents) * 30) * DAY);
  return { series, avgPerMonthCents, etaDate, reached };
}
