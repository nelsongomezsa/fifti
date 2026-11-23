"use client";


import { useTx } from "@/i18n/tx-client";
import { useMemo, useState } from "react";
import { SpendChart } from "@/components/charts/SpendChart";
import { Keypad } from "@/components/expense/Keypad";
import { DEMO_BUBBLES, type DemoBubble, type DemoExpense } from "@/lib/demo-data";
import { buildSplits, computeBalances, formatMoney, parseToCents, savingsRateBp, simplifyDebts, summarizeFund } from "@/lib/money";

const ACCENT = { personal: "var(--lilac)", household: "var(--lime)", group: "var(--tangerine)" } as const;
const MONTHS = ["jun", "jul", "ago", "sep", "oct", "nov"];
type Tab = "inicio" | "movimientos" | "plan";

/** Modo demo: 100 % en el navegador. Ninguna escritura sale del dispositivo ni hay acceso a datos reales. */
export function DemoApp() {
  const x = useTx();
  const [bubbleId, setBubbleId] = useState(DEMO_BUBBLES[0]!.id);
  const [tab, setTab] = useState<Tab>("inicio");
  const [extra, setExtra] = useState<Record<string, DemoExpense[]>>({});
  const [sheet, setSheet] = useState(false);
  const bubble = DEMO_BUBBLES.find((b) => b.id === bubbleId)!;
  const expenses = useMemo(() => [...(extra[bubble.id] ?? []), ...bubble.expenses], [extra, bubble]);
  const accent = ACCENT[bubble.kind];

  return (
    <div data-bubble={bubble.kind} className="mx-auto min-h-dvh max-w-md pb-28">
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

      {sheet && <DemoSheet b={bubble} onClose={() => setSheet(false)} onSave={(x) => { setExtra((p) => ({ ...p, [bubble.id]: [x, ...(p[bubble.id] ?? [])] })); setSheet(false); }} />}
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
  const series = b.series.map((c, i) => ({ label: MONTHS[i]!, cents: i === 5 ? fundsSpent : c, current: i === 5 }));
  return (
    <section className="flex flex-col gap-5 pt-2">
      <div>
        <p className="text-sm text-ink-3">{x("Te sobra en noviembre")}</p>
        <p className={`money font-mono text-5xl font-semibold ${leftover < 0 ? "text-over-text" : ""}`}>{formatMoney(leftover, "EUR", x.locale)}</p>
        <p className="money mt-1 font-mono text-sm text-ink-2">{change >= 0 ? "+" : ""}{formatMoney(change, "EUR", x.locale)} {x("vs. mes anterior")}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {[["Ingresos", formatMoney(b.income, "EUR", x.locale)], ["Tasa de ahorro", `${Math.round(savingsRateBp(b.income, fundsSpent) / 100)} %`], ["Previsión día 30", formatMoney(leftover - 4000, "EUR", x.locale)]].map(([k, v]) => (
          <div key={k} className="rounded-card border border-border bg-surface p-3"><dt className="text-xs text-ink-3">{k}</dt><dd className="money mt-1 font-mono text-base">{v}</dd></div>
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
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, r.usedBp / 100)}%`, background: r.status === "over" ? "var(--over)" : r.status === "warn" ? "var(--tangerine)" : f.color }} /></span></td>
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

function DemoSheet({ b, onClose, onSave }: { b: DemoBubble; onClose: () => void; onSave: (x: DemoExpense) => void }) {
  const x = useTx();
  const [amount, setAmount] = useState("");
  const [text, setText] = useState("");
  const cents = parseToCents(amount) ?? 0;
  const share = b.kind === "personal" ? cents : buildSplits(Math.max(cents, 1), "equal", b.members.map((m) => ({ memberId: m, defaultBp: null })))[0]!.amountCents * (cents ? 1 : 0);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={x("Nuevo gasto")} onClick={(ev) => ev.stopPropagation()} className="anim-sheet max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-[24px] border border-border bg-surface-2 p-4">
        <h2 className="mb-2 text-lg font-bold">{x("Nuevo gasto en")}{" "}{b.name}</h2>
        <output className="mb-2 block text-center font-mono text-5xl font-semibold">{amount || "0"} <span className="text-3xl text-ink-3">€</span></output>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={60} placeholder={x("Concepto")} aria-label={x("Concepto")} className="mb-3 min-h-12 w-full rounded-card border border-border bg-surface px-4 text-ink" />
        <Keypad value={amount} onChange={setAmount} />
        <p className="mt-3 flex justify-between text-sm text-ink-2"><span>{b.kind === "personal" ? x("Solo lo ves tú") : x("Tu parte")}</span><span className="money font-mono text-lg text-ink">{formatMoney(share, "EUR", x.locale)}</span></p>
        <button disabled={cents <= 0 || !text.trim()} onClick={() => onSave({ id: crypto.randomUUID(), text: text.trim(), cents, category: "Demo", day: 23, payer: b.members[0]!, participants: b.members })}
          className="mt-3 min-h-14 w-full rounded-full font-semibold text-on-accent disabled:opacity-50" style={{ background: ACCENT[b.kind] }}>{x("Guardar en")}{" "}{b.name}</button>
      </div>
    </div>
  );
}
