"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";
import { createTransfer } from "@/server/actions/accounts";

export type SplitItem = { toId: string; toName: string; color: string; cents: number };

/** «Reparte tu nómina»: traspasos sugeridos con el reparto del plan. Marcarlos crea el traspaso en Fifti; el dinero lo mueve la persona en su banco. */
export function PayrollSplitCard({ fromId, fromName, items, demo, currency }: { fromId: string; fromName: string; items: SplitItem[]; demo: boolean; currency: string }) {
  const x = useTx();
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();
  const left = items.filter((i) => !done.has(i.toId));
  if (left.length === 0) return null;
  const fmt = (c: number) => formatMoney(c, currency, x.locale);
  const mark = (i: SplitItem) => {
    setErr(null);
    if (demo) return setErr(x("Crea una cuenta para guardar"));
    setDone((d) => new Set(d).add(i.toId)); // optimista
    start(async () => {
      const r = await createTransfer({ fromId, toId: i.toId, amountCents: i.cents, date: new Date().toISOString().slice(0, 10), note: x("Reparto de la nómina"), source: "payroll_split" }).catch(() => null);
      if (!r?.ok) { setDone((d) => { const n = new Set(d); n.delete(i.toId); return n; }); setErr(r?.error ?? x("No se ha podido completar.")); } else router.refresh();
    });
  };
  return (
    <section aria-labelledby="split-title" className="rounded-card border border-border bg-surface p-4">
      <h2 id="split-title" className="font-semibold">{left.length === 1 ? x("Tienes 1 traspaso pendiente") : `${x("Tienes")} ${left.length} ${x("traspasos pendientes")}`}</h2>
      <p className="text-xs text-ink-3">{x("Reparte tu nómina desde")} {fromName}. {x("Tú mueves el dinero en tu banco; aquí solo lo marcas.")}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {left.map((i) => (
          <li key={i.toId} className="flex items-center gap-3 text-sm">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: i.color }} />
            <span className="min-w-0 flex-1">{x("Pasa")} <span className="money font-mono">{fmt(i.cents)}</span> {x("a")} <strong className="font-medium">{i.toName}</strong></span>
            <button type="button" onClick={() => mark(i)} className="min-h-11 shrink-0 rounded-full border border-border px-4 font-semibold">{x("Hecho")}</button>
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-over-text">{err}</p>}
    </section>
  );
}
