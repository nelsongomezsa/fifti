"use client";


import { useTx } from "@/i18n/tx-client";
import { useMemo, useRef, useState } from "react";
import { SpendChart } from "@/components/charts/SpendChart";
import { Keypad } from "@/components/expense/Keypad";
import { ExpenseSheet } from "@/components/expense/ExpenseSheet";
import { buildDemoContext } from "@/lib/demo-context";
import type { ExpenseInput } from "@/lib/validation/expense";
import type { SaveResult } from "@/server/actions/expenses";
import { DEMO_BUBBLES, type DemoBubble, type DemoExpense } from "@/lib/demo-data";
import { buildSplits, computeBalances, formatMoney, groupTyped, parseToCents, savingsRateBp, simplifyDebts, summarizeFund } from "@/lib/money";

const ACCENT = { personal: "var(--lilac)", household: "var(--lime)", group: "var(--tangerine)" } as const;
const MONTHS = ["jun", "jul", "ago", "sep", "oct", "nov"];
const FULL = ["Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre"];
const FULL_EN = ["June", "July", "August", "September", "October", "November"];
type Tab = "inicio" | "movimientos" | "plan";

/** Modo demo: 100 % en el navegador. Ninguna escritura sale del dispositivo ni hay acceso a datos reales. */
export function DemoApp() {
  const x = useTx();
  const [bubbleId, setBubbleId] = useState(DEMO_BUBBLES[0]!.id);
  const [tab, setTab] = useState<Tab>("inicio");
  const [extra, setExtra] = useState<Record<string, DemoExpense[]>>({});
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<{ bubbleId: string; id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubble = DEMO_BUBBLES.find((b) => b.id === bubbleId)!;
  const expenses = useMemo(() => [...(extra[bubble.id] ?? []), ...bubble.expenses], [extra, bubble]);
  const accent = ACCENT[bubble.kind];
  const demoCtx = useMemo(() => buildDemoContext(), []);

  /** Entrega en memoria del gasto de la hoja real: nada sale del navegador. */
  const saveDemoExpense = (input: ExpenseInput): SaveResult => {
    const sp = demoCtx.spaces.find((v) => v.id === input.spaceId);
    if (!sp) return { ok: false, error: "Burbuja no encontrada" };
    const name = (id: string) => sp.members.find((m) => m.id === id)?.name ?? sp.members[0]!.name;
    const ex: DemoExpense = {
      id: crypto.randomUUID(), text: input.description, cents: input.amountCents, day: Number(input.spentAt.slice(8, 10)),
      category: sp.categories.find((c) => c.id === input.categoryId)?.name ?? "Demo",
      payer: name(input.payers[0]?.memberId ?? sp.meId), participants: input.participants.map(name),
    };
    let share = input.amountCents;
    try {
      const lines = buildSplits(input.amountCents, sp.kind === "personal" ? "equal" : input.splitMode, input.participants.map((id) => ({ memberId: id, defaultBp: sp.members.find((m) => m.id === id)?.defaultBp ?? null })), input.custom);
      share = lines.find((l) => l.memberId === sp.meId)?.amountCents ?? 0;
    } catch { /* reparto no válido: la hoja ya lo avisa */ }
    setExtra((p) => ({ ...p, [sp.id]: [ex, ...(p[sp.id] ?? [])] }));
    setBubbleId(sp.id);
    setToast({ bubbleId: sp.id, id: ex.id, text: sp.kind === "personal" ? "Personal" : sp.name });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
    return { ok: true, id: ex.id, shareCents: share };
  };

  return (
    <div data-bubble={bubble.kind} className="mx-auto min-h-dvh max-w-md pb-[calc(8rem+env(safe-area-inset-bottom))]">
      <p role="note" className="bg-surface-2 px-4 py-2 text-center text-xs text-ink-2">{x("Modo demo · datos ficticios · nada se guarda")}</p>
      <nav aria-label={x("Burbujas")} className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
        {DEMO_BUBBLES.map((b) => {
          const on = b.id === bubbleId;
          return (
            <button key={b.id} aria-pressed={on} onClick={() => setBubbleId(b.id)} className="min-h-11 whitespace-nowrap rounded-full border px-4 text-sm font-medium"
              style={on ? { background: ACCENT[b.kind], color: "var(--on-accent)", borderColor: ACCENT[b.kind] } : { borderColor: "var(--border)", color: "var(--text-2)" }}>
              {b.name}
            </button>
          );
        })}
      </nav>
      <main className="px-4">
        {tab === "inicio" && <Home b={bubble} expenses={expenses} />}
        {tab === "movimientos" && <Movements b={bubble} expenses={expenses} />}
        {tab === "plan" && <Plan b={bubble} />}
      </main>

      <nav aria-label={x("Principal")} className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md items-end">
          {(["inicio", "movimientos"] as const).map((t) => <TabBtn key={t} t={t} on={tab === t} set={setTab} />)}
          <div className="flex flex-1 justify-center">
            <button aria-label={x("Añadir gasto")} onClick={() => setSheet(true)} className="-mt-5 mb-2 grid size-16 place-items-center rounded-full text-on-accent shadow-[0_0_0_6px_var(--bg)]" style={{ background: accent }}>
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </button>
          </div>
          {(["plan"] as const).map((t) => <TabBtn key={t} t={t} on={tab === t} set={setTab} />)}
          <a href="/registro" className="flex min-h-14 flex-1 flex-col items-center justify-center text-[11px] font-medium text-ink-3">{x("Crear cuenta")}</a>
        </div>
      </nav>

      {sheet && (
        <ExpenseSheet ctx={demoCtx} defaultSpaceId={bubble.id} onClose={() => setSheet(false)} onSaved={() => undefined}
          demo={{ submit: async (input) => saveDemoExpense(input) }} />
      )}
      {toast && (
        <div role="status" className="anim-fade fixed inset-x-4 bottom-[calc(7rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-4 py-3 shadow-lg">
          <span className="text-sm">{x("Guardado en ")}{toast.text}</span>
          <button type="button" className="min-h-11 px-3 text-sm font-semibold" onClick={() => { setExtra((p) => ({ ...p, [toast.bubbleId]: (p[toast.bubbleId] ?? []).filter((e) => e.id !== toast.id) })); setToast(null); }}>{x("Deshacer")}</button>
        </div>
      )}
    </div>
  );
}

function TabBtn({ t, on, set }: { t: Tab; on: boolean; set: (t: Tab) => void }) {
  const x = useTx();
  const label = x({ inicio: "Inicio", movimientos: "Movimientos", plan: "Plan" }[t]);
  return (
    <button onClick={() => set(t)} aria-current={on ? "page" : undefined} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? "text-ink" : "text-ink-3"}`}>
      {label}<span aria-hidden className="h-0.5 w-5 rounded-full" style={{ background: on ? "var(--accent)" : "transparent" }} />
    </button>
  );
}

function Home({ b, expenses }: { b: DemoBubble; expenses: DemoExpense[] }) {
  const x = useTx();
  const addedSpent = expenses.filter((x) => !b.expenses.includes(x)).reduce((a, x) => a + x.cents, 0);
  const fundsSpent = b.funds.reduce((a, f) => a + f.spent, 0) + addedSpent;
  if (b.kind === "group") {
    const bal = computeBalances(b.members, expenses.map((ex) => ({
      paidFrom: "member" as const, payers: [{ memberId: ex.payer, amountCents: ex.cents }],
      splits: buildSplits(ex.cents, "equal", ex.participants.map((m) => ({ memberId: m, defaultBp: null }))).map((s) => ({ memberId: s.memberId, amountCents: s.amountCents })),
    })));
    const transfers = simplifyDebts(bal);
    const total = expenses.reduce((a, x) => a + x.cents, 0);
    return (
      <section className="flex flex-col gap-4 pt-2">
        <div><p className="text-sm text-ink-3">{x("Total del plan")}</p><p className="money font-mono text-5xl font-semibold">{formatMoney(total, "EUR", x.locale)}</p></div>
        <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-2">{x("Hoy os quedan")}{" "}<span className="money font-mono text-lg text-ink">{formatMoney(Math.max(0, 5000 * 4 - 1480) / 4, "EUR", x.locale)}</span> {x("por cabeza.")}</p>
        <h2 className="text-lg font-semibold">{x("Quién paga a quién")}</h2>
        {transfers.length === 0 ? <p className="text-ink-2">{x("Todo saldado.")}</p> : transfers.map((t) => (
          <div key={`${t.from}-${t.to}`} className="flex items-center justify-between rounded-card border border-border bg-surface p-4">
            <p>{t.from} → {t.to} <span className="money font-mono">{formatMoney(t.amountCents, "EUR", x.locale)}</span></p>
            <span className="min-h-11 rounded-full bg-accent px-5 py-2.5 font-semibold text-on-accent">{x("Saldar")}</span>
          </div>
        ))}
      </section>
    );
  }
  const leftover = b.income - fundsSpent;
  const change = leftover - b.prevLeftover;
  const series = b.series.map((c, i) => ({ label: MONTHS[i]!, full: (x.locale === "en-GB" ? FULL_EN : FULL)[i]!, cents: i === 5 ? fundsSpent : c, current: i === 5 }));
  return (
    <section className="flex flex-col gap-5 pt-2">
      <div>
        <p className="text-sm text-ink-3">{x("Te sobra en noviembre")}</p>
        <p className={`money font-mono text-5xl font-semibold ${leftover < 0 ? "text-over-text" : ""}`}>{formatMoney(leftover, "EUR", x.locale)}</p>
        <p className="money mt-1 font-mono text-sm text-ink-2">{change >= 0 ? "+" : ""}{formatMoney(change, "EUR", x.locale)} {x("vs. mes anterior")}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {[["Ingresos", formatMoney(b.income, "EUR", x.locale)], ["Tasa de ahorro", `${Math.round(savingsRateBp(b.income, fundsSpent) / 100)} %`], ["Previsión día 30", formatMoney(leftover - 4000, "EUR", x.locale)]].map(([k, v]) => (
          <div key={k} className="@container min-w-0 rounded-card border border-border bg-surface p-3"><dt className="text-xs text-ink-3">{k}</dt><dd className="money mt-1 whitespace-nowrap font-mono" style={{ fontSize: "clamp(0.68rem, 15cqw, 1rem)" }}>{v}</dd></div>
        ))}
      </dl>
      <div className="rounded-card border border-border bg-surface p-4"><h2 className="mb-2 text-sm text-ink-3">{x("Gasto de los últimos 6 meses")}</h2><SpendChart data={series} currency="EUR" /></div>
      <FundTable b={b} />
    </section>
  );
}

function FundTable({ b }: { b: DemoBubble }) {
  const x = useTx();
  return (
    <div className="rounded-card border border-border bg-surface">
      <h2 className="px-4 pt-4 text-sm text-ink-3">{x("Fondos")}</h2>
      <table className="w-full text-sm"><caption className="sr-only">{x("Uso de cada fondo")}</caption><tbody>
        {b.funds.map((f) => {
          const r = summarizeFund(f.name, f.planned, f.spent);
          return (
            <tr key={f.name} className="border-t border-border first:border-t-0">
              <td className="px-4 py-3"><span className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</span>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.usedBp / 100)}%`, background: r.status === "over" ? "var(--over)" : r.status === "warn" ? "var(--warn)" : f.color }} /></span></td>
              <td className={`money px-4 py-3 text-right font-mono ${r.status === "over" ? "text-over-text" : "text-ink-2"}`}>{Math.round(r.usedBp / 100)} %</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

function Movements({ b, expenses }: { b: DemoBubble; expenses: DemoExpense[] }) {
  const x = useTx();
  return (
    <section className="flex flex-col gap-3 pt-2">
      <h1 className="text-2xl font-bold">{x("Movimientos")}</h1>
      <ul className="flex flex-col gap-2">
        {expenses.map((ex) => (
          <li key={ex.id} className="flex min-h-14 items-center justify-between rounded-card border border-border bg-surface px-4 py-3">
            <span><span className="block font-medium">{ex.text}</span><span className="text-xs text-ink-3">{ex.day} {x("nov ·")}{" "}{ex.category}{b.kind === "group" ? ` · pagó ${ex.payer}` : ""}</span></span>
            <span className="money font-mono">{formatMoney(ex.cents, "EUR", x.locale)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Plan({ b }: { b: DemoBubble }) {
  const x = useTx();
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">{x("Plan")}</h1>
      <FundTable b={b} />
      <p className="text-sm text-ink-3">{x("En la app real: burbujas por fondo, previsión de fin de mes, cierre de mes y bote común.")}</p>
    </section>
  );
}
