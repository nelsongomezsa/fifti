import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { addMonths, formatMoney, monthStart } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { loadOverview } from "@/server/overview";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Resumen mensual" };

export default async function MonthlySummaryPage() {
  const x = await getTx();
  await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active) return null;
  const month = addMonths(monthStart(new Date()), -1);
  const o = await loadOverview(await createClient(), active.id, active.kind, month, addMonths(month, 1));
  const name = new Date(`${month}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const top = [...o.funds].sort((a, b) => b.spent - a.spent).slice(0, 3).filter((f) => f.spent > 0);
  return (
    <section className="flex flex-col gap-4 pt-2">
      <Link href="/inicio" className="text-sm text-ink-2">{x("‹ Inicio")}</Link>
      <h1 className="text-2xl font-bold first-letter:uppercase">{x("Resumen de")}{" "}{name}</h1>
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm text-ink-3">{x("Te sobró")}</p>
        <p className={`money font-mono text-4xl font-semibold ${o.leftover < 0 ? "text-over-text" : ""}`}>{formatMoney(o.leftover, "EUR", x.locale)}</p>
        <p className="money mt-2 flex justify-between font-mono text-sm text-ink-2"><span>{x("Ingresos")}{" "}{formatMoney(o.income, "EUR", x.locale)}</span><span>{x("Gasto")}{" "}{formatMoney(o.spent, "EUR", x.locale)}</span></p>
        <p className="mt-1 text-sm text-ink-2">{x("Tasa de ahorro")}{" "}<span className="money font-mono">{(o.savingsBp / 100).toFixed(0)} %</span></p>
      </div>
      {top.length > 0 && (
        <div className="rounded-card border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">{x("Donde más gastaste")}</h2>
          {top.map((f) => <p key={f.fundId} className="flex justify-between text-sm"><span>{f.name}</span><span className="money font-mono">{formatMoney(f.spent, "EUR", x.locale)}</span></p>)}
        </div>
      )}
    </section>
  );
}
