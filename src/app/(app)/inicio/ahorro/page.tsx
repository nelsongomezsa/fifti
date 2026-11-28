import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney, lastMonths } from "@/lib/money";
import { savingsSeries } from "@/lib/savings-series";
import { detailContext } from "@/server/inicio-detail";
import { loadOverview, seriesFor } from "@/server/overview";

export const metadata: Metadata = { title: "Tasa de ahorro" };

export default async function SavingsDetailPage() {
  const { x, active, supabase, month, today } = await detailContext();
  const overview = await loadOverview(supabase, active.id, active.kind, month, today, x.locale, true);
  const months = lastMonths(month, 6);
  const older = active.kind === "group" ? null : await seriesFor(supabase, active.id, active.kind === "personal", months[0]!);
  const rows = older ? savingsSeries(months, older.inc, older.spend, active.kind === "personal" ? older.mir : []) : [];
  // El mes en curso usa la tasa PREVISTA del plan; la real solo se enseña en los meses ya cerrados
  if (rows.length) rows[rows.length - 1] = { month, income: overview.income, spent: overview.spent, leftover: overview.leftover, rateBp: overview.plannedSavingsBp };
  const plannedSaved = overview.funds.filter((f) => f.kind === "savings").reduce((a, f) => a + f.planned, 0);
  const pct = (bp: number) => `${bp < 0 ? "−" : ""}${(Math.abs(bp) / 100).toLocaleString(x.locale, { maximumFractionDigits: 0 })} %`;
  const monthLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const amount = (cents: number) => formatMoney(cents, active.currency, x.locale);

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/inicio" className="flex min-h-11 items-center text-sm text-ink-2">‹ {x("Inicio")}</Link>
      <div>
        <h1 className="text-2xl font-bold">{x("Tasa de ahorro")}</h1>
        <p className="mt-1 text-sm text-ink-3">{monthLabel(month)}</p>
        {active.kind !== "group" && <><p className="money mt-2 font-mono text-5xl font-semibold">{pct(overview.plannedSavingsBp)}</p><p className="mt-1 text-sm text-ink-2">{x("prevista este mes")}</p></>}
      </div>
      {active.kind === "group" ? <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{x("La tasa de ahorro no se aplica a grupos.")}</p> : <>
        <section className="rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-ink-2">{x("Durante el mes enseñamos la tasa PREVISTA de tu plan: lo que va al fondo de Ahorro entre tus ingresos. Así no sale una tasa altísima solo porque aún has gastado poco.")}</p>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex justify-between gap-3"><dt>{x("Ingresos")}</dt><dd className="money font-mono">{amount(overview.income)}</dd></div>
            <div className="flex justify-between gap-3"><dt>{x("Ahorro previsto en el plan")}</dt><dd className="money font-mono">{amount(plannedSaved)}</dd></div>
            <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><dt>{x("Tasa de ahorro prevista")}</dt><dd className="money font-mono">{pct(overview.plannedSavingsBp)}</dd></div>
          </dl>
          <p className="mt-4 text-sm text-ink-2">{x("Al cierre del mes calculamos la real: (ingresos − gastos) ÷ ingresos. La verás aquí en cuanto el mes termine; los meses anteriores ya muestran la real.")}</p>
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">{x("Últimos 6 meses")}</h2>
          <ol className="flex flex-col gap-3" aria-label={x("Evolución de la tasa de ahorro")}>
            {rows.map((row) => {
              const value = row.rateBp;
              const width = value === null ? 0 : Math.max(0, Math.min(100, value / 100));
              return <li key={row.month} className="rounded-card border border-border bg-surface p-4">
                <div className="flex justify-between gap-3 text-sm"><span>{monthLabel(row.month)}{row.month === month ? ` · ${x("prevista")}` : ""}</span><span className={value !== null && value < 0 ? "font-mono text-over-text" : "font-mono"}>{value === null ? x("Sin ingresos") : pct(value)}</span></div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-track" role="img" aria-label={value === null ? x("Sin ingresos") : x("Tasa: {porcentaje}").replace("{porcentaje}", pct(value))}>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                </div>
              </li>;
            })}
          </ol>
        </section>
      </>}
    </section>
  );
}
