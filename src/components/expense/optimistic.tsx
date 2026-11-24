"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";
import { useTx } from "@/i18n/tx-client";

/** Gasto que ya se ve en pantalla aunque el servidor todavía no haya confirmado el guardado. */
export type PendingExpense = {
  cid: string; spaceId: string; description: string; amountCents: number; baseCents: number; shareCents: number;
  currency: string; spentAt: string; status: "saving" | "queued" | "saved";
};

type Ctx = { items: PendingExpense[]; add: (p: PendingExpense) => void; patch: (cid: string, p: Partial<PendingExpense>) => void; remove: (cids: string[]) => void };
const PendingContext = createContext<Ctx | null>(null);

export function PendingExpensesProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<PendingExpense[]>([]);
  const add = useCallback((p: PendingExpense) => setItems((l) => [p, ...l.filter((i) => i.cid !== p.cid)]), []);
  const patch = useCallback((cid: string, p: Partial<PendingExpense>) => setItems((l) => l.map((i) => (i.cid === cid ? { ...i, ...p } : i))), []);
  const remove = useCallback((cids: string[]) => setItems((l) => l.filter((i) => !cids.includes(i.cid))), []);
  const value = useMemo(() => ({ items, add, patch, remove }), [items, add, patch, remove]);
  return <PendingContext.Provider value={value}>{children}</PendingContext.Provider>;
}

const NOOP: Ctx = { items: [], add: () => undefined, patch: () => undefined, remove: () => undefined };
export function usePendingExpenses(): Ctx {
  return useContext(PendingContext) ?? NOOP;
}

/** Filas provisionales al principio de la lista de Movimientos (desaparecen cuando llega la lista real). */
export function PendingExpenseRows({ spaceId, month }: { spaceId: string; month: string }) {
  const x = useTx();
  const { items } = usePendingExpenses();
  const mine = items.filter((i) => i.spaceId === spaceId && i.spentAt.startsWith(month.slice(0, 7)));
  if (mine.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label={x("Guardando…")}>
      {mine.map((i) => (
        <li key={i.cid} className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-dashed border-border bg-surface px-4 py-3 opacity-80">
          <span className="min-w-0">
            <span className="block truncate font-medium">{i.description}</span>
            <span className="text-xs text-ink-3">{i.status === "queued" ? x("Pendiente de subir") : x("Guardando…")}</span>
          </span>
          <span className="money font-mono">{formatMoney(i.amountCents, i.currency, x.locale)}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Te sobra" con los gastos provisionales ya descontados. Con la lista real vuelve al valor del servidor. */
export function OptimisticLeftover({ base, spaceId, kind, currency, className }: { base: number; spaceId: string; kind: "personal" | "household" | "group"; currency: string; className?: string }) {
  const x = useTx();
  const { items } = usePendingExpenses();
  const delta = items.filter((i) => i.spaceId === spaceId).reduce((a, i) => a + (kind === "personal" ? i.shareCents : i.baseCents), 0);
  const v = base - delta;
  return <p className={`money font-mono text-5xl font-semibold ${v < 0 ? "text-over-text" : ""} ${className ?? ""}`}>{formatMoney(v, currency, x.locale)}</p>;
}
