"use client";

import { useMemo, useRef, useState } from "react";
import { PlanBubbles } from "@/components/charts/PlanBubbles";
import { SpendChart } from "@/components/charts/SpendChart";
import { ExpenseSheet, type SheetPrefill } from "@/components/expense/ExpenseSheet";
import { useTx } from "@/i18n/tx-client";
import { buildDemoContext } from "@/lib/demo-context";
import { DEMO_BUBBLES, DEMO_GOALS, type DemoBubble, type DemoExpense } from "@/lib/demo-data";
import { buildSplits, computeBalances, formatMoney, savingsRateBp, simplifyDebts, summarizeFund } from "@/lib/money";
import type { ExpenseInput } from "@/lib/validation/expense";
import type { SaveResult } from "@/server/actions/expenses";

const ACCENT = { personal: "var(--lilac)", household: "var(--lime)", group: "var(--tangerine)" } as const;
const MONTHS = ["jun", "jul", "ago", "sep", "oct", "nov"];
const FULL = ["Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre"];
const FULL_EN = ["June", "July", "August", "September", "October", "November"];
type Tab = "inicio" | "movimientos" | "balance" | "plan" | "ahorro";

/** Color de la barra de un fondo: ámbar al 80 %, rojo si se pasa; un fondo de ahorro lleno es un logro (lima), no un exceso. */
const barColor = (status: "ok" | "warn" | "over", color: string, savings?: boolean) =>
  savings && status !== "ok" ? "var(--lime)" : status === "over" ? "var(--over)" : status === "warn" ? "var(--warn)" : color;

/** Modo demo: 100 % en el navegador. Ninguna escritura sale del dispositivo ni hay acceso a datos reales. */
export function DemoApp() {
  const x = useTx();
  const [bubbleId, setBubbleId] = useState(DEMO_BUBBLES[0]!.id);
  const [tab, setTab] = useState<Tab>("inicio");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [extra, setExtra] = useState<Record<string, DemoExpense[]>>({});
  const [edits, setEdits] = useState<Record<string, DemoExpense>>({});
  const [deleted, setDeleted] = useState<string[]>([]);
  const [settled, setSettled] = useState<string[]>([]);
  const [sheet, setSheet] = useState<SheetPrefill | null>(null);
  const [toast, setToast] = useState<{ bubbleId: string; id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubble = DEMO_BUBBLES.find((b) => b.id === bubbleId)!;
  const accent = ACCENT[bubble.kind];
  const demoCtx = useMemo(() => buildDemoContext(), []);

  const expensesOf = (b: DemoBubble) =>
    [...(extra[b.id] ?? []), ...b.expenses].map((e) => edits[e.id] ?? e).filter((e) => !deleted.includes(e.id));
  const expenses = expensesOf(bubble);

  /** Entrega en memoria del gasto de la hoja real (alta o edición): nada sale del navegador. */
  const saveDemoExpense = (input: ExpenseInput): SaveResult => {
    const sp = demoCtx.spaces.find((v) => v.id === input.spaceId);
    if (!sp) return { ok: false, error: "Burbuja no encontrada" };
    const name = (id: string) => sp.members.find((m) => m.id === id)?.name ?? sp.members[0]!.name;
    const ex: DemoExpense = {
      id: input.id ?? crypto.randomUUID(), text: input.description, cents: input.amountCents, day: Number(input.spentAt.slice(8, 10)),
      category: sp.categories.find((c) => c.id === input.categoryId)?.name ?? (sp.kind === "group" ? "Otros" : sp.categories[0]!.name),
      payer: name(input.payers[0]?.memberId ?? sp.meId), participants: input.participants.map(name),
    };
    let share = input.amountCents;
    try {
      const lines = buildSplits(input.amountCents, sp.kind === "personal" ? "equal" : input.splitMode, input.participants.map((id) => ({ memberId: id, defaultBp: sp.members.find((m) => m.id === id)?.defaultBp ?? null })), input.custom);
      share = lines.find((l) => l.memberId === sp.meId)?.amountCents ?? 0;
    } catch { /* reparto no válido: la hoja ya lo avisa */ }
    if (input.id) setEdits((p) => ({ ...p, [ex.id]: ex }));
    else setExtra((p) => ({ ...p, [sp.id]: [ex, ...(p[sp.id] ?? [])] }));
    setBubbleId(sp.id);
    if (!input.id) {
      setToast({ bubbleId: sp.id, id: ex.id, text: sp.kind === "personal" ? "Personal" : sp.name });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 5000);
    }
    return { ok: true, id: ex.id, shareCents: share };
  };

  const go = (t: Tab) => { setTab(t); setDetailId(null); };

  return (
    <div data-bubble={bubble.kind} className="mx-auto min-h-dvh max-w-md pb-[calc(8rem+env(safe-area-inset-bottom))]">
      <div role="note" className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-1 text-xs text-ink-2">
        <span>{x("Modo demo · datos ficticios · nada se guarda")}</span>
        <a href="/registro" className="inline-flex min-h-11 items-center rounded-full bg-lime px-4 text-sm font-semibold text-on-accent">{x("Crear cuenta")}</a>
      </div>
      <nav aria-label={x("Burbujas")} className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
        {DEMO_BUBBLES.map((b) => {
          const on = b.id === bubbleId;
          return (
            <button key={b.id} aria-pressed={on} onClick={() => { setBubbleId(b.id); setDetailId(null); }} className="min-h-11 whitespace-nowrap rounded-full border px-4 text-sm font-medium"
              style={on ? { background: ACCENT[b.kind], color: "var(--on-accent)", borderColor: ACCENT[b.kind] } : { borderColor: "var(--border)", color: "var(--text-2)" }}>
              {b.name}
            </button>
          );
        })}
      </nav>
      <main className="px-4">
        {tab === "inicio" && <Home b={bubble} expenses={expenses} settled={settled} onGo={go} />}
        {tab === "movimientos" && !detailId && <Movements expenses={expenses} b={bubble} onOpen={setDetailId} />}
        {tab === "movimientos" && detailId && (
          <Detail
            b={bubble} expense={expenses.find((e) => e.id === detailId)} onBack={() => setDetailId(null)}
            onEdit={(ex) => setSheet({
              spaceId: bubble.id, amountCents: ex.cents, description: ex.text, categoryId: `${bubble.id}:c:${ex.category}`,
              participants: ex.participants.map((n) => `${bubble.id}:${n}`), payerId: `${bubble.id}:${ex.payer}`,
              edit: { id: ex.id, clientId: ex.id, spentAt: `2026-11-${String(ex.day).padStart(2, "0")}`, paidFrom: "member", splitMode: "equal", isPrivate: false },
            })}
            onDelete={(id) => { setDeleted((d) => [...d, id]); setDetailId(null); }}
          />
        )}
        {tab === "balance" && <Balance b={bubble} expenses={expenses} settled={settled} onSettle={(k) => setSettled((s) => [...s, k])} />}
        {tab === "plan" && <Plan b={bubble} expenses={expenses} />}
        {tab === "ahorro" && <Savings />}
      </main>

      <nav aria-label={x("Principal")} className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md items-end">
          {(["inicio", "movimientos", "balance"] as const).map((t) => <TabBtn key={t} t={t} on={tab === t} set={go} />)}
          <div className="flex flex-1 justify-center">
            <button aria-label={x("Añadir gasto")} onClick={() => setSheet({})} className="-mt-5 mb-2 grid size-16 place-items-center rounded-full text-on-accent shadow-[0_0_0_6px_var(--bg)]" style={{ background: accent }}>
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </button>
          </div>
          {(["plan", "ahorro"] as const).map((t) => <TabBtn key={t} t={t} on={tab === t} set={go} />)}
        </div>
      </nav>

      {sheet && (
        <ExpenseSheet ctx={demoCtx} defaultSpaceId={bubble.id} prefill={sheet} onClose={() => setSheet(null)} onSaved={() => undefined}
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
  const label = x({ inicio: "Inicio", movimientos: "Movimientos", balance: "Balance", plan: "Plan", ahorro: "Ahorro" }[t]);
  return (
    <button onClick={() => set(t)} aria-current={on ? "page" : undefined} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? "text-ink" : "text-ink-3"}`}>
      {label}<span aria-hidden className="h-0.5 w-5 rounded-full" style={{ background: on ? "var(--accent)" : "transparent" }} />
    </button>
  );
}

/** Reparto igual entre los participantes de cada gasto → saldos y pagos para quedar a cero. */
function balancesOf(b: DemoBubble, expenses: DemoExpense[]) {
  const bal = computeBalances(b.members, expenses.map((ex) => ({
    paidFrom: "member" as const, payers: [{ memberId: ex.payer, amountCents: ex.cents }],
    splits: buildSplits(ex.cents, "equal", ex.participants.map((m) => ({ memberId: m, defaultBp: null }))).map((s) => ({ memberId: s.memberId, amountCents: s.amountCents })),
  })));
  return { bal, transfers: simplifyDebts(bal) };
}

function Home({ b, expenses, settled, onGo }: { b: DemoBubble; expenses: DemoExpense[]; settled: string[]; onGo: (t: Tab) => void }) {
  const x = useTx();
  const spent = expenses.reduce((a, ex) => a + ex.cents, 0); // = suma de Movimientos
  const fmt = (c: number) => formatMoney(c, "EUR", x.locale);
  if (b.kind === "group") {
    const { transfers } = balancesOf(b, expenses);
    return (
      <section className="flex flex-col gap-4 pt-2">
        <div><p className="text-sm text-ink-3">{x("Total del plan")}</p><p className="money font-mono text-5xl font-semibold">{fmt(spent)}</p></div>
        <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-2">{x("Hoy os quedan")}{" "}<span className="money font-mono text-lg text-ink">{fmt(Math.max(0, 5000 * 4 - 1480) / 4)}</span>{" "}{x("por cabeza.")}</p>
        <h2 className="text-lg font-semibold">{x("Quién paga a quién")}</h2>
        {transfers.filter((t) => !settled.includes(`${t.from}-${t.to}`)).length === 0 ? <p className="text-ink-2">{x("Todo saldado.")}</p> : transfers.filter((t) => !settled.includes(`${t.from}-${t.to}`)).map((t) => (
          <div key={`${t.from}-${t.to}`} className="flex items-center justify-between rounded-card border border-border bg-surface p-4">
            <p>{t.from} → {t.to} <span className="money font-mono">{fmt(t.amountCents)}</span></p>
            <button className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent" onClick={() => onGo("balance")}>{x("Saldar")}</button>
          </div>
        ))}
      </section>
    );
  }
  const leftover = b.income - spent;
  const change = leftover - b.prevLeftover;
  const series = b.series.map((c, i) => ({ label: MONTHS[i]!, full: (x.locale === "en-GB" ? FULL_EN : FULL)[i]!, cents: i === 5 ? spent : c, current: i === 5 }));
  const { transfers } = balancesOf(b, expenses);
  const open = b.kind === "household" ? transfers.filter((t) => !settled.includes(`${t.from}-${t.to}`))[0] : undefined;
  return (
    <section className="flex flex-col gap-5 pt-2">
      <div>
        <p className="text-sm text-ink-3">{x("Te sobra en noviembre")}</p>
        <p className={`money font-mono text-5xl font-semibold ${leftover < 0 ? "text-over-text" : ""}`}>{fmt(leftover)}</p>
        <p className="money mt-1 font-mono text-sm text-ink-2">{change >= 0 ? "+" : ""}{fmt(change)} {x("vs. mes anterior")}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {[[x("Ingresos"), fmt(b.income)], [x("Tasa de ahorro"), `${Math.round(savingsRateBp(b.income, spent) / 100)} %`], [x("Previsión día 30"), fmt(leftover - 4000)]].map(([k, v]) => (
          <div key={k} className="@container min-w-0 rounded-card border border-border bg-surface p-3"><dt className="text-xs text-ink-3">{k}</dt><dd className="money mt-1 whitespace-nowrap font-mono" style={{ fontSize: "clamp(0.68rem, 15cqw, 1rem)" }}>{v}</dd></div>
        ))}
      </dl>
      <div className="rounded-card border border-border bg-surface p-4"><h2 className="mb-2 text-sm text-ink-3">{x("Gasto de los últimos 6 meses")}</h2><SpendChart data={series} currency="EUR" /></div>
      {open && (
        <div className="flex items-center justify-between rounded-card border border-border bg-surface p-4">
          <p><span className="block text-xs text-ink-3">{x("Pendiente de pago")}</span>{open.from} → {open.to} <span className="money font-mono">{fmt(open.amountCents)}</span></p>
          <button className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent" onClick={() => onGo("balance")}>{x("Saldar")}</button>
        </div>
      )}
      <FundTable b={b} expenses={expenses} />
    </section>
  );
}

function fundRows(b: DemoBubble, expenses: DemoExpense[]) {
  return b.funds.map((f) => {
    const spent = expenses.filter((e) => e.category === f.name).reduce((a, e) => a + e.cents, 0); // calculado de los movimientos
    return { ...f, spent, row: summarizeFund(f.name, f.planned, spent) };
  });
}

function FundTable({ b, expenses }: { b: DemoBubble; expenses: DemoExpense[] }) {
  const x = useTx();
  return (
    <div className="rounded-card border border-border bg-surface">
      <h2 className="px-4 pt-4 text-sm text-ink-3">{x("Fondos")}</h2>
      <table className="w-full text-sm"><caption className="sr-only">{x("Uso de cada fondo")}</caption><tbody>
        {fundRows(b, expenses).map((f) => (
          <tr key={f.name} className="border-t border-border first:border-t-0">
            <td className="px-4 py-3"><span className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</span>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, f.row.usedBp / 100)}%`, background: barColor(f.row.status, f.color, f.savings) }} /></span></td>
            <td className={`money px-4 py-3 text-right font-mono ${f.row.status === "over" && !f.savings ? "text-over-text" : "text-ink-2"}`}>{Math.round(f.row.usedBp / 100)} %</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

function Movements({ expenses, b, onOpen }: { expenses: DemoExpense[]; b: DemoBubble; onOpen: (id: string) => void }) {
  const x = useTx();
  const total = expenses.reduce((a, e) => a + e.cents, 0);
  return (
    <section className="flex flex-col gap-3 pt-2">
      <h1 className="text-2xl font-bold">{x("Movimientos")}</h1>
      <p className="flex justify-between text-sm text-ink-2"><span>{expenses.length === 1 ? x("1 gasto") : `${expenses.length} ${x("gastos")}`}</span><span className="money font-mono text-ink">{formatMoney(total, "EUR", x.locale)}</span></p>
      <ul className="flex flex-col gap-2">
        {expenses.map((ex) => (
          <li key={ex.id}>
            <button onClick={() => onOpen(ex.id)} className="flex min-h-14 w-full items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-left">
              <span><span className="block font-medium">{ex.text}</span><span className="text-xs text-ink-3">{ex.day} {x("nov ·")}{" "}{ex.category}{b.kind === "group" ? ` · ${x("Pagó")} ${ex.payer}` : ""}</span></span>
              <span className="money font-mono">{formatMoney(ex.cents, "EUR", x.locale)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detail({ b, expense, onBack, onEdit, onDelete }: { b: DemoBubble; expense?: DemoExpense; onBack: () => void; onEdit: (e: DemoExpense) => void; onDelete: (id: string) => void }) {
  const x = useTx();
  const [confirm, setConfirm] = useState(false);
  if (!expense) return null;
  const splits = buildSplits(expense.cents, "equal", expense.participants.map((m) => ({ memberId: m, defaultBp: null })));
  return (
    <section className="flex flex-col gap-5 pt-2">
      <button onClick={onBack} className="min-h-11 self-start text-sm text-ink-2">{x("‹ Movimientos")}</button>
      <div>
        <h1 className="text-2xl font-bold">{expense.text}</h1>
        <p className="money mt-1 font-mono text-3xl">{formatMoney(expense.cents, "EUR", x.locale)}</p>
        <p className="mt-1 text-sm text-ink-3">{expense.day} {x("nov ·")}{" "}{expense.category}</p>
      </div>
      <div className="flex gap-3">
        <button onClick={() => onEdit(expense)} className="min-h-11 rounded-full border border-border px-5 font-semibold">{x("Editar")}</button>
        <button onClick={() => setConfirm(true)} className="min-h-11 rounded-full border border-border px-5 font-semibold text-over-text">{x("Borrar")}</button>
      </div>
      {b.kind !== "personal" && (
        <div className="rounded-card border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">{x("Pagó")}</h2>
          <p className="flex justify-between text-sm"><span>{expense.payer}</span><span className="money font-mono">{formatMoney(expense.cents, "EUR", x.locale)}</span></p>
          <h2 className="mb-2 mt-4 font-semibold">{x("Reparto")}</h2>
          {splits.map((s) => <p key={s.memberId} className="flex justify-between text-sm text-ink-2"><span>{s.memberId}</span><span className="money font-mono text-ink">{formatMoney(s.amountCents, "EUR", x.locale)}</span></p>)}
        </div>
      )}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setConfirm(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="demo-del" onClick={(e) => e.stopPropagation()} className="anim-sheet m-4 w-full max-w-sm rounded-[24px] border border-border bg-surface-2 p-5">
            <h2 id="demo-del" className="text-lg font-bold">{x("¿Borrar este gasto?")}</h2>
            <div className="mt-4 flex gap-3">
              <button onClick={() => setConfirm(false)} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
              <button onClick={() => onDelete(expense.id)} className="min-h-12 flex-1 rounded-full bg-over font-semibold text-on-accent">{x("Borrar")}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Balance({ b, expenses, settled, onSettle }: { b: DemoBubble; expenses: DemoExpense[]; settled: string[]; onSettle: (k: string) => void }) {
  const x = useTx();
  const fmt = (c: number) => formatMoney(c, "EUR", x.locale);
  if (b.kind === "personal") return <section className="pt-2"><h1 className="text-2xl font-bold">{x("Balance")}</h1><p className="mt-3 rounded-card border border-border bg-surface p-4 text-ink-2">{x("Tu burbuja personal no tiene deudas. Elige un hogar o un plan para ver saldos.")}</p></section>;
  const { bal, transfers } = balancesOf(b, expenses);
  const open = transfers.filter((t) => !settled.includes(`${t.from}-${t.to}`));
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">{x("Balance de")} {b.name}</h1>
      <ul className="flex flex-col gap-2">
        {b.members.map((m) => <li key={m} className="flex justify-between rounded-card border border-border bg-surface px-4 py-3"><span>{m}</span><span className={`money font-mono ${(bal[m] ?? 0) < 0 ? "text-over-text" : ""}`}>{(bal[m] ?? 0) > 0 ? "+" : ""}{fmt(bal[m] ?? 0)}</span></li>)}
      </ul>
      <h2 className="text-lg font-semibold">{x("Para quedar a cero")}</h2>
      {open.length === 0 ? <p className="text-ink-2">{x("Todo está saldado.")}</p> : open.map((t) => (
        <div key={`${t.from}-${t.to}`} className="flex items-center justify-between rounded-card border border-border bg-surface p-4">
          <p>{t.from} → {t.to} <span className="money font-mono">{fmt(t.amountCents)}</span></p>
          <button onClick={() => onSettle(`${t.from}-${t.to}`)} className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent">{x("Marcar como pagado")}</button>
        </div>
      ))}
      <p className="text-xs text-ink-3">{x("Fifti no mueve dinero: paga por tu app y marca aquí que está hecho.")}</p>
    </section>
  );
}

function Plan({ b, expenses }: { b: DemoBubble; expenses: DemoExpense[] }) {
  const x = useTx();
  const [view, setView] = useState<"burbujas" | "lista">("burbujas");
  if (b.kind === "group") return <section className="pt-2"><h1 className="text-2xl font-bold">{x("Plan")}</h1><p className="mt-3 rounded-card border border-border bg-surface p-4 text-ink-2">{x("En la app real: burbujas por fondo, previsión de fin de mes, cierre de mes y bote común.")}</p></section>;
  const rows = fundRows(b, expenses);
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">{x("Plan")}</h1>
      <nav aria-label={x("Vista")} className="flex gap-2">
        {([["burbujas", "Burbujas"], ["lista", "Lista"]] as const).map(([v, l]) => (
          <button key={v} aria-current={view === v ? "page" : undefined} onClick={() => setView(v)} className={`min-h-11 rounded-full border px-4 text-sm ${view === v ? "border-accent bg-surface-2" : "border-border text-ink-2"}`}>{x(l)}</button>
        ))}
      </nav>
      {view === "burbujas"
        ? <PlanBubbles currency="EUR" funds={rows.map((f) => ({ id: f.name, name: f.name, color: f.savings && f.row.status !== "ok" ? "#C6F432" : f.color, planned: f.planned, spent: f.spent, savings: f.savings }))} />
        : <FundTable b={b} expenses={expenses} />}
      <p className="text-sm text-ink-3">{x("En la app real: burbujas por fondo, previsión de fin de mes, cierre de mes y bote común.")}</p>
    </section>
  );
}

function Savings() {
  const x = useTx();
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">{x("Ahorro")}</h1>
      <ul className="flex flex-col gap-3">
        {DEMO_GOALS.map((g) => {
          const pct = Math.min(100, Math.round((g.savedCents * 100) / g.targetCents));
          const done = pct >= 100;
          return (
            <li key={g.id} className="rounded-card border border-border bg-surface p-4">
              <p className="flex items-center justify-between"><span className="font-medium">{g.name}</span>{done && <span className="rounded-full bg-lime px-3 py-0.5 text-xs font-semibold text-on-accent">{x("Meta alcanzada")}</span>}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={g.name}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: done ? "var(--lime)" : "var(--lilac)" }} />
              </div>
              <p className="money mt-2 flex justify-between font-mono text-xs text-ink-2"><span>{formatMoney(g.savedCents, "EUR", x.locale)} {x("de")} {formatMoney(g.targetCents, "EUR", x.locale)}</span><span>{pct} %</span></p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
