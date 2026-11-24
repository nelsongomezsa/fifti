"use client";

import { Flag } from "lucide-react";
import { createElement, useState } from "react";
import { categoryIcon } from "@/components/ui/CategoryIcon";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";

export type CalEvent = { date: string; label: string; cents: number; kind: "fijo" | "meta"; payer?: string; sysName?: string | null; color?: string };

/** Mes en cuadrícula: en cada día, el icono de la categoría y el importe (o puntos si hay varios). Tocar un día enseña sus cobros. */
export function CalendarMonth({ label, offset, days, events, todayDay }: { label: string; offset: number; days: number; events: CalEvent[]; todayDay: number | null }) {
  const x = useTx();
  const [sel, setSel] = useState<number | null>(null);
  const byDay = new Map<number, CalEvent[]>();
  for (const e of events) { const d = Number(e.date.slice(8, 10)); byDay.set(d, [...(byDay.get(d) ?? []), e]); }
  const shown = sel === null ? events : (byDay.get(sel) ?? []);
  const fmt = (c: number) => formatMoney(c, "EUR", x.locale);
  const compact = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace(".", ","));
  const icon = (e: CalEvent, size: number) => (e.kind === "meta" ? <Flag size={size} strokeWidth={2.2} /> : createElement(categoryIcon(e.sysName), { size, strokeWidth: 2.2 }));

  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`${x("Calendario de")} ${label}`}>
        {["L", "M", "X", "J", "V", "S", "D"].map((d) => <span key={d} className="py-1 text-ink-3" role="columnheader">{x(d)}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`o${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1, list = byDay.get(day) ?? [];
          const isToday = todayDay === day, on = sel === day;
          const first = list[0];
          return (
            <span key={day} role="gridcell">
              <button type="button" onClick={() => setSel(on ? null : day)} aria-pressed={on} disabled={list.length === 0 && !isToday}
                aria-label={list.length ? `${day}: ${list.map((e) => `${e.label} ${fmt(e.cents)}`).join(", ")}` : String(day)}
                className={`flex min-h-14 w-full flex-col items-center justify-start gap-0.5 rounded-card border px-0.5 py-1 transition-colors ${on ? "border-accent bg-surface-2" : list.length ? "border-border bg-surface" : "border-transparent"} ${isToday ? "ring-2 ring-accent" : ""} disabled:cursor-default`}>
                <span className={`font-mono text-[11px] leading-none ${isToday ? "font-bold text-ink" : "text-ink-3"}`}>{day}</span>
                {first && list.length === 1 && (
                  <>
                    <span aria-hidden style={{ color: first.color ?? "var(--accent)" }}>{icon(first, 15)}</span>
                    <span className="money font-mono text-[9px] leading-none text-ink-2">{compact(first.cents)}</span>
                  </>
                )}
                {first && list.length > 1 && (
                  <>
                    <span aria-hidden style={{ color: first.color ?? "var(--accent)" }}>{icon(first, 15)}</span>
                    <span aria-hidden className="flex items-center gap-0.5">{list.slice(1, 3).map((e, k) => <span key={k} className="size-1.5 rounded-full" style={{ background: e.color ?? "var(--accent)" }} />)}<span className="font-mono text-[9px] leading-none text-ink-3">+{list.length - 1}</span></span>
                  </>
                )}
              </button>
            </span>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm text-ink-3">{sel === null ? x("Todos los cobros del mes") : `${x("Cobros del día")} ${sel}`}</h2>
        {sel !== null && <button type="button" onClick={() => setSel(null)} className="min-h-11 px-2 text-sm text-ink-2 underline-offset-4 hover:underline">{x("Ver todo el mes")}</button>}
      </div>
      {shown.length === 0 ? <p className="text-ink-3">{sel === null ? x("No hay pagos previstos este mes.") : x("No hay cobros este día.")}</p> : (
        <ul className="flex flex-col gap-2">
          {shown.map((e, i) => (
            <li key={i} className="flex items-center gap-3 rounded-card border border-border bg-surface px-3 py-3 text-sm">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: `${e.color ?? "#9AA3AF"}2e`, color: e.color ?? "var(--accent)" }}>{icon(e, 20)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{e.label}</span>
                <span className="block text-xs text-ink-3">{new Date(`${e.date}T00:00:00Z`).toLocaleDateString(x.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · {e.kind === "meta" ? x("pago de meta") : x("gasto fijo")}{e.payer ? ` · ${x("Paga")} ${e.payer}` : ""}</span></span>
              <span className="money shrink-0 font-mono">{fmt(e.cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
