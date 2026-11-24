import { addMonths, lastMonths } from "@/lib/money";

/** Comparativas de gasto: este mes frente al mismo mes del año anterior y a la media de 3 meses, categorías que más suben y bajan, 12 meses por fondo. */
export type BreakdownRow = { month: string; categoryId: string | null; cents: number };
export type MirrorRow = { month: string; fundId: string | null; cents: number };
export type Mover = { categoryId: string | null; currentCents: number; avgCents: number; deltaCents: number };
export type Trends = {
  currentCents: number;
  lastYearCents: number | null;
  avg3Cents: number | null;
  vsLastYearBp: number | null;
  vsAvg3Bp: number | null;
  up: Mover[];
  down: Mover[];
  months: string[];
  /** por mes: gasto de cada fondo (clave = id del fondo, "none" = sin fondo) */
  byFund: Record<string, number>[];
  fundIds: string[];
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (now: number, base: number | null) => (base && base > 0 ? Math.round(((now - base) * 10000) / base) : null);

export function computeTrends(rows: BreakdownRow[], mirror: MirrorRow[], month: string, fundOfCategory: Record<string, string>, minDeltaCents = 100): Trends {
  const total = (m: string) => sum(rows.filter((r) => r.month === m).map((r) => r.cents)) + sum(mirror.filter((r) => r.month === m).map((r) => r.cents));
  const prev3 = [1, 2, 3].map((n) => addMonths(month, -n));
  const hasData = (m: string) => rows.some((r) => r.month === m) || mirror.some((r) => r.month === m);
  const currentCents = total(month);
  const lastYear = addMonths(month, -12);
  const lastYearCents = hasData(lastYear) ? total(lastYear) : null;
  const withData = prev3.filter(hasData);
  const avg3Cents = withData.length ? Math.round(sum(withData.map(total)) / withData.length) : null;

  // Categorías: este mes frente a la media de los 3 meses anteriores (los meses sin datos cuentan como 0 para no inflar la subida)
  const cats = new Set<string | null>(rows.filter((r) => r.month === month || prev3.includes(r.month)).map((r) => r.categoryId));
  const movers: Mover[] = [...cats].map((c) => {
    const at = (m: string) => sum(rows.filter((r) => r.month === m && r.categoryId === c).map((r) => r.cents));
    const avg = Math.round(sum(prev3.map(at)) / 3);
    return { categoryId: c, currentCents: at(month), avgCents: avg, deltaCents: at(month) - avg };
  });
  const up = movers.filter((m) => m.deltaCents >= minDeltaCents).sort((a, b) => b.deltaCents - a.deltaCents).slice(0, 3);
  const down = movers.filter((m) => m.deltaCents <= -minDeltaCents).sort((a, b) => a.deltaCents - b.deltaCents).slice(0, 3);

  const months = lastMonths(month, 12);
  const fundKey = (categoryId: string | null) => (categoryId && fundOfCategory[categoryId]) || "none";
  const byFund = months.map((m) => {
    const o: Record<string, number> = {};
    for (const r of rows.filter((x) => x.month === m)) o[fundKey(r.categoryId)] = (o[fundKey(r.categoryId)] ?? 0) + r.cents;
    for (const r of mirror.filter((x) => x.month === m)) { const k = r.fundId ?? "none"; o[k] = (o[k] ?? 0) + r.cents; }
    return o;
  });
  const fundIds = [...new Set(byFund.flatMap((o) => Object.keys(o)))].sort((a, b) => sum(byFund.map((o) => o[b] ?? 0)) - sum(byFund.map((o) => o[a] ?? 0)));
  return { currentCents, lastYearCents, avg3Cents, vsLastYearBp: pct(currentCents, lastYearCents), vsAvg3Bp: pct(currentCents, avg3Cents), up, down, months, byFund, fundIds };
}
