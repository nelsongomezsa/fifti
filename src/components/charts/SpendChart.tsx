"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";

export type SpendPoint = { label: string; full: string; cents: number; current: boolean; month?: string };

/** Gasto de los últimos meses; el mes actual va en el color de acento de la burbuja. El tooltip solo aparece al tocar o pasar el ratón. */
export function SpendChart({ data, currency }: { data: SpendPoint[]; currency: string }) {
  const x = useTx();
  const router = useRouter();
  const fmt = (c: number) => formatMoney(c, currency, x.locale);
  return (
    <div className="h-40 w-full" role="img" aria-label={`${x("Gasto de los últimos 6 meses")}: ${data.map((d) => `${d.full} ${fmt(d.cents)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} accessibilityLayer={false}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--text-3)", fontSize: 11, fontFamily: "var(--font-plex-mono)" }} />
          <Tooltip
            cursor={{ fill: "transparent" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as SpendPoint | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-card border border-border bg-surface-2 px-3 py-2 text-sm text-ink">
                  {p.full} · <span className="money font-mono">{fmt(p.cents)}</span>
                </div>
              );
            }}
          />
          <Bar dataKey="cents" radius={[6, 6, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={(p) => { const m = (p as unknown as { payload?: SpendPoint }).payload?.month; if (m) router.push(`/movimientos?mes=${m}`); }}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.current ? "var(--accent)" : "var(--track)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {/* Mismo acceso para teclado y lector de pantalla: cada mes lleva a sus movimientos */}
      <ul className="sr-only">{data.filter((d) => d.month).map((d) => <li key={d.month}><Link href={`/movimientos?mes=${d.month}`}>{d.full}: {fmt(d.cents)}</Link></li>)}</ul>
    </div>
  );
}
