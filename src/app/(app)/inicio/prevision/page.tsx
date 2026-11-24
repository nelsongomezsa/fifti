import type { Metadata } from "next";
import Link from "next/link";
import { projectRecurring } from "@/lib/calendar";
import { forecastBreakdown, formatMoney } from "@/lib/money";
import { detailContext } from "@/server/inicio-detail";
import { loadOverview } from "@/server/overview";

export const metadata: Metadata = { title: "Previsión de fin de mes" };

export default async function ForecastPage() {
  const { x, active, supabase, month, monthName, today } = await detailContext();
  const back = <Link href="/inicio" className="min-h-11 self-start text-sm text-ink-2">{x("‹ Inicio")}</Link>;
  if (active.kind === "group") return <section className="flex flex-col gap-4 pt-2">{back}<p className="rounded-card border border-border bg-surface p-4 text-ink-2">{x("La previsión de fin de mes es para tu burbuja personal y los hogares.")}</p></section>;

  const [o, { data: rec }] = await Promise.all([
    loadOverview(supabase, active.id, active.kind, month, today, x.locale, true),
    supabase.from("recurring_expenses").select("id, description, amount_cents, frequency, day, next_run").eq("space_id", active.id).eq("active", true),
  ]);
  const fixed = o.funds.filter((f) => f.kind === "fixed");
  const spentFixed = fixed.reduce((a, f) => a + f.spent, 0);
  const plannedFixed = fixed.reduce((a, f) => a + f.planned, 0);
  const b = forecastBreakdown({ monthIso: month, today, spentVariable: o.spent - spentFixed, spentFixed, plannedFixed, income: o.income });
  const fmt = (c: number) => formatMoney(c, "EUR", x.locale);

  // Cobros fijos programados que aún faltan este mes (hoy incluido)
  const pending = (rec ?? [])
    .flatMap((r) => projectRecurring({ id: r.id, description: r.description, amountCents: r.amount_cents, frequency: r.frequency, day: r.day, nextRun: r.next_run }, month).map((date) => ({ date, label: r.description, cents: r.amount_cents })))
    .filter((c) => c.date >= today).sort((a, b2) => a.date.localeCompare(b2.date) || a.label.localeCompare(b2.label));
  const pendingTotal = pending.reduce((a, c) => a + c.cents, 0);

  const line = (label: string, value: number, opts: { sign?: "+" | "−" | "="; strong?: boolean; hint?: string } = {}) => (
    <li className={`flex items-start justify-between gap-3 py-3 ${opts.strong ? "font-semibold" : ""}`}>
      <span className="min-w-0"><span className="block">{opts.sign && <span aria-hidden className="mr-2 text-ink-3">{opts.sign}</span>}{label}</span>{opts.hint && <span className="mt-0.5 block text-xs font-normal text-ink-3">{opts.hint}</span>}</span>
      <span className={`money shrink-0 font-mono ${opts.strong && value < 0 ? "text-over-text" : ""}`}>{fmt(value)}</span>
    </li>
  );

  return (
    <section className="flex flex-col gap-5 pt-2">
      {back}
      <div>
        <h1 className="text-2xl font-bold">{x("Previsión día 30")}</h1>
        <p className="text-sm text-ink-3 first-letter:uppercase">{monthName}</p>
      </div>
      <p className="text-sm text-ink-2">{x("Cuánto te sobrará a final de mes si sigues a este ritmo: ingresos menos lo ya gastado, menos el gasto del día a día que falta al ritmo de hasta hoy, menos los gastos fijos que aún no se han pagado.")}</p>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface px-4">
        {line(x("Ingresos del mes"), b.income)}
        {line(x("Gastado hasta hoy"), b.spentSoFar, { sign: "−" })}
        {line(x("Gasto del día a día que falta"), b.variableToGo, { sign: "−", hint: `${fmt(b.dailyRate)} ${x("al día")} × ${b.daysLeft} ${b.daysLeft === 1 ? x("día") : x("días")}` })}
        {line(x("Gastos fijos pendientes"), b.fixedPending, { sign: "−", hint: `${x("El plan prevé")} ${fmt(plannedFixed)} ${x("y llevas")} ${fmt(spentFixed)}` })}
        {line(x("Te sobrará el día 30"), b.projectedLeftover, { sign: "=", strong: true })}
      </ul>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{x("Cobros fijos que faltan este mes")}</h2>
        {pending.length === 0 ? <p className="text-sm text-ink-3">{x("No hay cobros fijos programados para lo que queda de mes.")}</p> : (
          <>
            <ul className="flex flex-col gap-2">
              {pending.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 text-sm">
                  <span className="min-w-0"><span className="block truncate">{c.label}</span><span className="text-xs text-ink-3">{new Date(`${c.date}T00:00:00Z`).toLocaleDateString(x.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span></span>
                  <span className="money shrink-0 font-mono">{fmt(c.cents)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between px-1 text-sm text-ink-2"><span>{x("Total programado")}</span><span className="money font-mono text-ink">{fmt(pendingTotal)}</span></p>
          </>
        )}
        <p className="text-xs text-ink-3">{x("La previsión usa lo que reserva tu plan para gastos fijos; esta lista son los cobros programados en el calendario.")}</p>
      </div>
      <Link href="/calendario?vista=proximos" className="inline-flex min-h-12 items-center justify-center rounded-full border border-border px-6 font-semibold">{x("Ver próximos cobros")}</Link>
    </section>
  );
}
