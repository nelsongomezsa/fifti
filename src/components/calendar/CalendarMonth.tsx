"use client";

import { Flag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createElement, useState, useTransition } from "react";
import { categoryIcon } from "@/components/ui/CategoryIcon";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";
import { setRecurringSkip } from "@/server/actions/plan";

export type CalEvent = {
  date: string; label: string; cents: number; kind: "fijo" | "meta"; payer?: string; sysName?: string | null; color?: string;
  recurringId?: string; categoryName?: string; alertOn?: string; skipped?: boolean;
};

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Mes en cuadrícula: cada día con su número, el punto del color de la partida y el importe corto; el día elegido (borde lila) enseña sus cobros con Editar y Saltar este mes. */
export function CalendarMonth({ label, offset, days, events: serverEvents, todayDay, advanceDays }: { label: string; offset: number; days: number; events: CalEvent[]; todayDay: number | null; advanceDays: number }) {
  const x = useTx();
  const router = useRouter();
  const [, start] = useTransition();
  // Respuesta optimista: «Saltar» se ve al instante y se confirma por detrás (si falla, vuelve a como estaba)
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const keyOf = (e: CalEvent) => `${e.recurringId}|${e.date}`;
  const events = serverEvents.map((e) => (e.recurringId && keyOf(e) in optimistic ? { ...e, skipped: optimistic[keyOf(e)] } : e));
  const byDay = new Map<number, CalEvent[]>();
  for (const e of events) { const d = Number(e.date.slice(8, 10)); byDay.set(d, [...(byDay.get(d) ?? []), e]); }
  const firstDay = [...byDay.keys()].sort((a, b) => a - b)[0] ?? null;
  const [sel, setSel] = useState<number | null>(todayDay ?? firstDay);
  const [error, setError] = useState<string | null>(null);
  const fmt = (c: number) => formatMoney(c, "EUR", x.locale);
  const compact = (c: number) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace(".", ","));
  const icon = (e: CalEvent, size: number) => (e.kind === "meta" ? <Flag size={size} strokeWidth={2.2} /> : createElement(categoryIcon(e.sysName), { size, strokeWidth: 2.2 }));
  const active = events.filter((e) => !e.skipped);
  const total = active.reduce((a, e) => a + e.cents, 0);
  const shown = sel === null ? [] : (byDay.get(sel) ?? []);

  const skip = (e: CalEvent, skipIt: boolean) => {
    setError(null);
    const k = keyOf(e);
    setOptimistic((o) => ({ ...o, [k]: skipIt }));
    start(async () => {
      const r = await setRecurringSkip({ recurringId: e.recurringId, date: e.date, skip: skipIt }).catch(() => ({ ok: false as const, error: x("No se ha podido completar.") }));
      if (!r.ok) { setOptimistic((o) => { const n = { ...o }; delete n[k]; return n; }); setError(r.error ?? x("No se ha podido completar.")); }
      else router.refresh();
    });
  };

  return (
    <>
      <p className="text-sm text-ink-2">{active.length} {active.length === 1 ? x("cobro") : x("cobros")} · <span className="money font-mono text-ink">{fmt(total)}</span></p>
      <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label={`${x("Calendario de")} ${label}`}>
        {["L", "M", "X", "J", "V", "S", "D"].map((d) => <span key={d} className="py-1 text-ink-3" role="columnheader">{x(d)}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`o${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1, list = byDay.get(day) ?? [];
          const live = list.filter((e) => !e.skipped);
          const isToday = todayDay === day, on = sel === day;
          return (
            <span key={day} role="gridcell">
              <button type="button" onClick={() => setSel(on ? null : day)} aria-pressed={on}
                aria-label={list.length ? `${day}: ${list.map((e) => `${e.label} ${fmt(e.cents)}${e.skipped ? ` (${x("saltado")})` : ""}`).join(", ")}` : String(day)}
                className={`flex min-h-14 w-full flex-col items-center justify-start gap-0.5 rounded-card border px-0.5 py-1 transition-colors ${on ? "border-lilac bg-surface-2" : list.length ? "border-border bg-surface" : "border-transparent"} ${isToday ? "ring-2 ring-lilac" : ""}`}>
                <span className={`font-mono text-[13px] leading-none ${isToday ? "font-bold text-ink" : "text-ink-3"}`}>{day}</span>
                {live.length > 0 && (
                  <>
                    <span aria-hidden className="flex items-center gap-0.5">{live.slice(0, 3).map((e, k) => <span key={k} className="size-1.5 rounded-full" style={{ background: e.color ?? "var(--accent)" }} />)}</span>
                    <span className="money font-mono text-[13px] leading-none text-ink-2">{compact(live.reduce((a, e) => a + e.cents, 0))}</span>
                  </>
                )}
              </button>
            </span>
          );
        })}
      </div>

      <section aria-live="polite" className="flex flex-col gap-2">
        <h2 className="text-sm text-ink-3">{sel === null ? x("Elige un día") : new Date(`${events[0]?.date.slice(0, 8) ?? "2026-01-"}${String(sel).padStart(2, "0")}T00:00:00Z`).toLocaleDateString(x.locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</h2>
        {shown.length === 0 ? <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-3">{x("No hay cobros este día.")}</p> : shown.map((e, i) => (
          <article key={i} className={`rounded-card border border-border bg-surface p-4 ${e.skipped ? "opacity-70" : ""}`}>
            <div className="flex items-center gap-3">
              <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: `${e.color ?? "#9AA3AF"}2e`, color: e.color ?? "var(--accent)" }}>{icon(e, 20)}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate font-medium ${e.skipped ? "line-through" : ""}`}>{e.label}</p>
                <p className="truncate text-xs text-ink-3">{e.kind === "meta" ? x("Pago de meta") : e.categoryName ?? x("Gasto fijo")}{e.payer ? ` · ${x("Paga")} ${e.payer}` : ""}</p>
                {e.kind === "fijo" && !e.skipped && advanceDays > 0 && <p className="text-xs text-ink-3">{x("aviso el")} {new Date(`${addDays(e.date, -advanceDays)}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", timeZone: "UTC" })}</p>}
                {e.skipped && <p className="text-xs text-warn">{x("Saltado este mes")}</p>}
              </div>
              <span className="money shrink-0 font-mono">{fmt(e.cents)}</span>
            </div>
            {e.kind === "fijo" && e.recurringId && (
              <div className="mt-3 flex gap-2">
                <Link href={`/fijos/nuevo?id=${e.recurringId}`} className="flex min-h-11 flex-1 items-center justify-center rounded-full border border-border text-sm font-semibold">{x("Editar")}</Link>
                <button type="button" onClick={() => skip(e, !e.skipped)} className="min-h-11 flex-1 rounded-full border border-border text-sm font-semibold">{e.skipped ? x("Volver a activarlo") : x("Saltar este mes")}</button>
              </div>
            )}
          </article>
        ))}
        {error && <p role="alert" className="text-sm text-over-text">{error}</p>}
      </section>
    </>
  );
}
