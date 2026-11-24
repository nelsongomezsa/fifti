import type { Metadata } from "next";
import Link from "next/link";
import { FundTrendChart, type FundPoint } from "@/components/charts/FundTrendChart";
import { getTx } from "@/i18n/tx";
import { addMonths, formatMoney, monthStart } from "@/lib/money";
import { displayName } from "@/lib/system-names";
import { computeTrends } from "@/lib/trends";
import { createClient } from "@/lib/supabase/server";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Tendencias" };

const arrow = (bp: number | null) => (bp === null ? "—" : `${bp > 0 ? "▲ +" : bp < 0 ? "▼ " : ""}${Math.round(bp / 100)} %`);

export default async function TrendsPage() {
  const x = await getTx();
  await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active) return null;
  const supabase = await createClient();
  const month = monthStart(new Date());
  const from = addMonths(month, -12);
  const personal = active.kind === "personal";
  const [{ data: rows }, { data: mirror }, { data: funds }, { data: cats }] = await Promise.all([
    supabase.rpc("monthly_breakdown", { p_space: active.id, p_from: from }),
    personal ? supabase.rpc("monthly_mirror_by_fund", { p_from: from }) : Promise.resolve({ data: [] }),
    supabase.from("funds").select("id, name, color, system_key").eq("space_id", active.id),
    supabase.from("categories").select("id, name, system_key, fund_id").eq("space_id", active.id),
  ]);
  const fundOf = Object.fromEntries((cats ?? []).map((c) => [c.id, c.fund_id as string]));
  const t = computeTrends(
    ((rows ?? []) as { month: string; category_id: string | null; total_cents: number }[]).map((r) => ({ month: r.month, categoryId: r.category_id, cents: Number(r.total_cents) })),
    ((mirror ?? []) as { month: string; fund_id: string | null; total_cents: number }[]).map((r) => ({ month: r.month, fundId: r.fund_id, cents: Number(r.total_cents) })),
    month, fundOf,
  );
  const fmt = (c: number) => formatMoney(c, "EUR", x.locale);
  const catName = (id: string | null) => { const c = cats?.find((k) => k.id === id); return c ? displayName(x, c.name, c.system_key) : x("Sin categoría"); };
  const series = t.fundIds.map((id) => {
    const f = funds?.find((k) => k.id === id);
    return { id, name: f ? displayName(x, f.name, f.system_key) : x("Sin fondo"), color: f?.color ?? "#9AA3AF" };
  });
  const data: FundPoint[] = t.months.map((m, i) => ({
    label: new Date(`${m}T00:00:00Z`).toLocaleDateString(x.locale, { month: "narrow", timeZone: "UTC" }),
    full: new Date(`${m}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" }),
    ...Object.fromEntries(t.fundIds.map((id) => [id, t.byFund[i]![id] ?? 0])),
  }));
  const lastYear = new Date(`${addMonths(month, -12)}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const empty = t.currentCents === 0 && t.fundIds.length === 0;

  const compare = (label: string, base: number | null, bp: number | null) => (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="text-sm text-ink-3">{label}</p>
      {base === null ? <p className="mt-1 text-ink-2">{x("Aún no hay datos para comparar.")}</p> : (
        <>
          <p className={`mt-1 font-mono text-2xl font-semibold ${bp !== null && bp > 0 ? "text-warn" : ""}`}>{arrow(bp)}</p>
          <p className="money mt-1 font-mono text-sm text-ink-2">{fmt(t.currentCents)} {x("frente a")} {fmt(base)}</p>
        </>
      )}
    </div>
  );
  const moverList = (title: string, list: typeof t.up, sign: 1 | -1) => (
    <div>
      <h3 className="mb-1 text-sm text-ink-3">{title}</h3>
      {list.length === 0 ? <p className="text-sm text-ink-2">{x("Sin cambios importantes.")}</p> : (
        <ul className="flex flex-col gap-2">{list.map((m) => (
          <li key={String(m.categoryId)} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
            <span>{catName(m.categoryId)}<span className="block text-xs text-ink-3">{x("Media 3 meses")}: <span className="money font-mono">{fmt(m.avgCents)}</span></span></span>
            <span className={`money font-mono ${sign > 0 ? "text-warn" : "text-ink"}`}>{sign > 0 ? "▲ +" : "▼ −"}{fmt(Math.abs(m.deltaCents))}</span>
          </li>
        ))}</ul>
      )}
    </div>
  );

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/mas" className="min-h-11 self-start text-sm text-ink-2">{x("‹ Más")}</Link>
      <h1 className="text-2xl font-bold">{x("Tendencias")}</h1>
      <p className="text-sm text-ink-3">{personal ? x("Personal") : active.name}</p>
      {empty ? <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{x("Todavía no hay gastos para comparar.")}</p> : (
        <>
          <div className="grid grid-cols-1 gap-3">
            {compare(`${x("Este mes frente a")} ${lastYear}`, t.lastYearCents, t.vsLastYearBp)}
            {compare(x("Este mes frente a la media de 3 meses"), t.avg3Cents, t.vsAvg3Bp)}
          </div>
          {moverList(x("Categorías que más suben"), t.up, 1)}
          {moverList(x("Categorías que más bajan"), t.down, -1)}
          <h2 className="text-lg font-semibold">{x("12 meses por fondo")}</h2>
          <div className="rounded-card border border-border bg-surface p-4"><FundTrendChart data={data} funds={series} currency="EUR" /></div>
        </>
      )}
    </section>
  );
}
