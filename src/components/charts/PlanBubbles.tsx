"use client";

import { hierarchy, pack } from "d3-hierarchy";

export type BubbleFund = { id: string; name: string; color: string; planned: number; spent: number };

/** Vista de burbujas: tamaño = lo previsto, relleno = lo gastado; ámbar al 80 % y rojo si se pasa. */
export function PlanBubbles({ funds, currency }: { funds: BubbleFund[]; currency: string }) {
  const size = 320;
  const items = funds.filter((f) => f.planned > 0 || f.spent > 0).map((f) => ({ ...f, weight: Math.max(f.planned, f.spent, 1) }));
  if (items.length === 0) return <p className="text-sm text-ink-3">Define el plan para ver las burbujas.</p>;
  const root = hierarchy<{ children?: typeof items; weight?: number }>({ children: items }).sum((d) => ("weight" in d ? (d.weight ?? 0) : 0));
  const leaves = pack<{ children?: typeof items; weight?: number }>().size([size, size]).padding(6)(root).leaves();
  const fmt = (c: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency, maximumFractionDigits: 0 }).format(c / 100);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-sm" role="img"
      aria-label={`Burbujas del plan: ${items.map((i) => `${i.name} ${fmt(i.spent)} de ${fmt(i.planned)}`).join(", ")}`}>
      <defs>
        {leaves.map((l, i) => (
          <clipPath id={`bub-${i}`} key={i}><circle cx={l.x} cy={l.y} r={l.r} /></clipPath>
        ))}
      </defs>
      {leaves.map((l, i) => {
        const f = l.data as unknown as BubbleFund;
        const used = f.planned > 0 ? f.spent / f.planned : f.spent > 0 ? 1.2 : 0;
        const fill = used >= 1 ? "var(--over)" : used >= 0.8 ? "var(--tangerine)" : f.color;
        const h = Math.min(1, used) * l.r * 2;
        return (
          <g key={f.id}>
            <circle cx={l.x} cy={l.y} r={l.r} fill="var(--surface-2)" stroke={used >= 1 ? "var(--over)" : "var(--border)"} strokeWidth={used >= 1 ? 2 : 1} />
            <rect x={l.x - l.r} y={l.y + l.r - h} width={l.r * 2} height={h} fill={fill} opacity={0.85} clipPath={`url(#bub-${i})`} />
            {l.r > 22 && (
              <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(9, Math.min(13, l.r / 3.2))} fill="var(--text)" style={{ paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 3 }}>
                {f.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
