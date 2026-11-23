"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export type SpendPoint = { label: string; cents: number; current: boolean };

/** Gasto de los últimos meses; el mes actual va en el color de acento de la burbuja. */
export function SpendChart({ data, currency }: { data: SpendPoint[]; currency: string }) {
  const fmt = (c: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 0 }).format(c / 100);
  return (
    <div className="h-40 w-full" role="img" aria-label={`Gasto de los últimos meses: ${data.map((d) => `${d.label} ${fmt(d.cents)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--text-3)", fontSize: 11, fontFamily: "var(--font-plex-mono)" }} />
          <Tooltip
            cursor={{ fill: "transparent" }}
            formatter={(v) => [fmt(Number(v)), "Gasto"]}
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text)" }}
          />
          <Bar dataKey="cents" radius={[6, 6, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.current ? "var(--accent)" : "var(--track)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
