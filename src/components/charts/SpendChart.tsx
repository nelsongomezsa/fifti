"use client";

import Link from "next/link";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";

export type SpendPoint = { label: string; full: string; cents: number; current: boolean; month?: string };

/** Gasto de los últimos meses en barras de CSS puro: se pinta siempre (también en el servidor) y cada mes lleva a sus movimientos. */
export function SpendChart({ data, currency }: { data: SpendPoint[]; currency: string }) {
  const x = useTx();
  const fmt = (c: number) => formatMoney(c, currency, x.locale);
  const short = (c: number) => new Intl.NumberFormat(x.locale, { style: "currency", currency, maximumFractionDigits: 0, useGrouping: "always" }).format(c / 100);
  const max = Math.max(1, ...data.map((d) => d.cents));
  const withData = data.filter((d) => d.cents > 0).length;
  return (
    <div>
      <ul className="grid h-40 grid-flow-col auto-cols-fr items-end gap-2" aria-label={x("Gasto de los últimos 6 meses")}>
        {data.map((d, i) => {
          const body = (
            <>
              <span className="money font-mono text-[10px] leading-none text-ink-2">{d.cents > 0 ? short(d.cents) : ""}</span>
              <span className="flex w-full flex-1 items-end"><span className="block w-full rounded-t-md" style={{ height: `${Math.max(d.cents > 0 ? 4 : 2, Math.round((d.cents / max) * 100))}%`, background: d.current ? "var(--accent)" : "var(--track)" }} /></span>
              <span className="font-mono text-[11px] leading-none text-ink-3">{d.label}</span>
            </>
          );
          const cls = "flex h-full min-w-0 flex-col items-center gap-1";
          return (
            <li key={d.month ?? i} className="h-full min-w-0">
              {d.month ? <Link href={`/movimientos?mes=${d.month}`} aria-label={`${d.full}: ${fmt(d.cents)}`} className={cls}>{body}</Link> : <span aria-label={`${d.full}: ${fmt(d.cents)}`} className={cls}>{body}</span>}
            </li>
          );
        })}
      </ul>
      {withData <= 1 && <p className="mt-2 text-center text-sm text-ink-2">{x("Tu primer mes en Fifti")}</p>}
    </div>
  );
}
