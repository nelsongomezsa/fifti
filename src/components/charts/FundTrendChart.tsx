"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";

export type FundSeries = { id: string; name: string; color: string };
export type FundPoint = { label: string; full: string } & Record<string, number | string>;

/** 12 meses apilados por fondo. Legible en 390 px: barras anchas, solo la inicial del mes y la leyenda debajo con el total del año. */
export function FundTrendChart({ data, funds, currency }: { data: FundPoint[]; funds: FundSeries[]; currency: string }) {
  const x = useTx();
  const fmt = (c: number) => formatMoney(c, currency, x.locale);
  const totals = funds.map((f) => ({ ...f, total: data.reduce((a, d) => a + (Number(d[f.id]) || 0), 0) }));
  return (
    <div className="flex flex-col gap-3">
      <div className="h-52 w-full" role="img" aria-label={`${x("Gasto de los últimos 12 meses por fondo")}: ${totals.map((f) => `${f.name} ${fmt(f.total)}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} accessibilityLayer={false}>
            <XAxis dataKey="label" axisLine={false} tickLine={false} interval={0} tick={{ fill: "var(--text-3)", fontSize: 10, fontFamily: "var(--font-plex-mono)" }} />
            <Tooltip
              cursor={{ fill: "transparent" }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as FundPoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <div className="rounded-card border border-border bg-surface-2 px-3 py-2 text-sm text-ink">
                    <p className="font-semibold">{String(p.full)}</p>
                    {funds.filter((f) => Number(p[f.id]) > 0).map((f) => <p key={f.id}><span aria-hidden className="mr-1.5 inline-block size-2 rounded-full" style={{ background: f.color }} />{f.name} · <span className="money font-mono">{fmt(Number(p[f.id]))}</span></p>)}
                  </div>
                );
              }}
            />
            {funds.map((f, i) => <Bar key={f.id} dataKey={f.id} stackId="a" fill={f.color} isAnimationActive={false} radius={i === funds.length - 1 ? [4, 4, 0, 0] : 0} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {totals.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: f.color }} /><span className="truncate">{f.name}</span></span><span className="money font-mono text-ink-2">{fmt(f.total)}</span></li>
        ))}
      </ul>
    </div>
  );
}
