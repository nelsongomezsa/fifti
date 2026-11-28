import { SpendChart } from "@/components/charts/SpendChart";
import { formatMoney } from "@/lib/money";
import { seriesView, type SeriesData } from "@/server/overview";

const pct = (bp: number) => `${(bp / 100).toFixed(0)} %`;

/** Variación frente al mes anterior: llega por streaming cuando la serie está lista. */
export async function ChangeLine({ seriesP, month, leftover, locale, vsPrev, label, currency }: { seriesP: Promise<SeriesData>; month: string; leftover: number; locale: string; vsPrev: string; label: string; currency: string }) {
  const { change, prevHasData } = seriesView(await seriesP, month, leftover, locale);
  if (!prevHasData) return null; // sin datos del mes anterior no hay con qué comparar
  return (
    <p className="money mt-1 font-mono text-sm text-ink-2" aria-label={label}>
      {change.deltaCents >= 0 ? "+" : ""}{formatMoney(change.deltaCents, currency, locale)} {vsPrev}
      {change.percentBp !== null && ` (${change.percentBp >= 0 ? "+" : ""}${pct(change.percentBp)})`}
    </p>
  );
}

export async function ChartCard({ seriesP, month, leftover, locale, title, currency }: { seriesP: Promise<SeriesData>; month: string; leftover: number; locale: string; title: string; currency: string }) {
  const { series } = seriesView(await seriesP, month, leftover, locale);
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <h2 className="mb-2 text-sm text-ink-3">{title}</h2>
      <SpendChart data={series} currency={currency} />
    </div>
  );
}
