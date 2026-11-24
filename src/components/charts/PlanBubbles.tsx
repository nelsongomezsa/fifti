"use client";

import Link from "next/link";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";
import { hierarchy, pack } from "d3-hierarchy";

export type BubbleFund = { id: string; name: string; color: string; planned: number; spent: number; savings?: boolean; href?: string };

type Node = { children?: BubbleFund[] };
const shown = (n: string) => (n.length > 18 ? `${n.slice(0, 17)}…` : n);

/**
 * Burbujas del plan: el tamaño es lo previsto y la parte coloreada lo gastado; lo que queda va vacío ("lo que queda").
 * Cada fondo lleva SIEMPRE su color (igual que su punto y su barra). Debajo, una leyenda con gastado / previsto, porcentaje y lo que queda.
 */
export function PlanBubbles({ funds, currency }: { funds: BubbleFund[]; currency: string }) {
  const x = useTx();
  const size = 320;
  const items = funds.filter((f) => f.planned > 0);
  if (items.length === 0) return <p className="text-sm text-ink-3">{x("Define el plan para ver las burbujas.")}</p>;
  const root = hierarchy<Node & { weight?: number }>({ children: items.map((f) => ({ ...f, weight: Math.max(f.planned, f.spent, 1) })) } as never).sum((d) => d.weight ?? 0);
  const leaves = pack<Node & { weight?: number }>().size([size, size]).padding(6)(root).leaves();
  const fmt = (c: number) => formatMoney(c, currency, x.locale);

  return (
    <div className="flex flex-col gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-sm" role="group" aria-label={x("Burbujas del plan")}>
        <defs>{leaves.map((l, i) => <clipPath id={`bub-${i}`} key={i}><circle cx={l.x} cy={l.y} r={l.r} /></clipPath>)}</defs>
        {leaves.map((l, i) => {
          const f = l.data as unknown as BubbleFund;
          const used = f.planned > 0 ? f.spent / f.planned : 0;
          const h = Math.min(1, used) * l.r * 2;
          const pct = Math.round(used * 100);
          const body = (
            <g>
              <circle cx={l.x} cy={l.y} r={l.r} fill="var(--surface-2)" stroke="var(--border)" strokeWidth={1.5} />
              <rect x={l.x - l.r} y={l.y + l.r - h} width={l.r * 2} height={h} fill={f.color} opacity={0.92} clipPath={`url(#bub-${i})`} />
              {h > 0 && h < l.r * 2 && <line x1={l.x - l.r} x2={l.x + l.r} y1={l.y + l.r - h} y2={l.y + l.r - h} stroke="var(--text)" strokeOpacity={0.35} strokeDasharray="3 3" clipPath={`url(#bub-${i})`} />}
              {l.r > 26 && (
                <g>
                  <rect x={l.x - Math.min(l.r - 4, Math.max(26, shown(f.name).length * 3.4 + 10))} y={l.y - 13} width={Math.min(l.r - 4, Math.max(26, shown(f.name).length * 3.4 + 10)) * 2} height={26} rx={13} fill="var(--bg)" opacity={0.85} />
                  <text x={l.x} y={l.y - 2} textAnchor="middle" fontSize={Math.max(9, Math.min(11, l.r / 3.8))} fontWeight={600} fill="var(--text)">{shown(f.name)}</text>
                  <text x={l.x} y={l.y + 9} textAnchor="middle" fontSize={9} fill="var(--text-2)" fontFamily="var(--font-plex-mono)">{pct} %</text>
                </g>
              )}
            </g>
          );
          return f.href
            ? <Link key={f.id} href={f.href} aria-label={`${f.name}: ${fmt(f.spent)} / ${fmt(f.planned)} (${pct} %)`} className="cursor-pointer outline-none [&:focus-visible_circle]:stroke-[var(--accent)] [&:focus-visible_circle]:stroke-[3]">{body}</Link>
            : <g key={f.id} role="img" aria-label={`${f.name}: ${fmt(f.spent)} / ${fmt(f.planned)} (${pct} %)`}>{body}</g>;
        })}
      </svg>

      <ul className="divide-y divide-border rounded-card border border-border bg-surface">
        {items.map((f) => {
          const left = f.planned - f.spent;
          const pct = Math.round((f.spent / f.planned) * 100);
          const tone = f.savings ? "text-ink-2" : left < 0 ? "text-over-text" : pct >= 80 ? "text-warn" : "text-ink-2";
          const row = (
            <>
              <span className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2"><span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: f.color }} /><span className="truncate font-medium">{f.name}</span></span>
                <span className={`money shrink-0 font-mono ${tone}`}>{pct} %{f.href && <span aria-hidden className="ml-2 text-ink-3">›</span>}</span>
              </span>
              <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: f.color }} /></span>
              <span className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-ink-3">
                <span><span className="money font-mono text-ink-2">{fmt(f.spent)}</span> {x("de")} <span className="money font-mono">{fmt(f.planned)}</span></span>
                <span className={left < 0 ? "text-over-text" : ""}>{left >= 0 ? <>{x("Te quedan")} <span className="money font-mono">{fmt(left)}</span></> : <>{x("Te has pasado")} <span className="money font-mono">{fmt(-left)}</span></>}</span>
              </span>
            </>
          );
          return <li key={f.id}>{f.href ? <Link href={f.href} className="block px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-2">{row}</Link> : <div className="px-4 py-3">{row}</div>}</li>;
        })}
      </ul>
      <p className="flex items-center justify-center gap-2 text-xs text-ink-3"><span aria-hidden className="inline-block h-2.5 w-4 rounded-full bg-ink-3 opacity-70" />{x("Parte coloreada = gastado. La parte vacía es lo que queda.")}</p>
    </div>
  );
}
