"use client";

import { saveAccount } from "@/server/actions/accounts";
import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTx } from "@/i18n/tx-client";
import { formatMoney, parseToCents } from "@/lib/money";
import { suggestCategory } from "@/lib/nl/parse";
import { matchRule, type CategoryRule } from "@/lib/rules/match";
import { parsePercentToBp } from "@/lib/validation/spaces";
import { savePlan, saveRecurring } from "@/server/actions/plan";

type Member = { id: string; name: string; mine: boolean };
type Fund = { id: string; name: string; color: string; suggested: number | null };

/** Bienvenida en 2 pasos: ingresos del mes y plan sugerido editable. Se guarda con la misma acción (y validación) que el plan normal. */
export function WelcomePlan({ initialStep = 1, categories = [], rules = [], spaceId, month, currency, members, funds }: { initialStep?: 1 | 2 | 3 | 4; categories?: { id: string; name: string }[]; rules?: CategoryRule[]; spaceId: string; month: string; currency: string; members: Member[]; funds: Fund[] }) {
  const x = useTx();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialStep);
  const [accBusy, setAccBusy] = useState(false);
  const [accErr, setAccErr] = useState<string | null>(null);
  const [fixed, setFixed] = useState({ description: "", amount: "", day: "1" });
  const [fixedState, fixedAction, fixedPending] = useActionState(saveRecurring, {});
  const [income, setIncome] = useState<Record<string, string>>({});
  const [pct, setPct] = useState<Record<string, string>>(() => Object.fromEntries(funds.map((f) => [f.id, f.suggested === null ? "" : String(f.suggested)])));
  const [state, formAction, pending] = useActionState(savePlan, {});

  const cents = (id: string) => parseToCents(income[id] ?? "") ?? 0;
  const total = members.reduce((a, m) => a + cents(m.id), 0);
  const mine = members.find((m) => m.mine);
  const step1Ok = !!mine && cents(mine.id) > 0 && members.every((m) => (income[m.id] ?? "") === "" || parseToCents(income[m.id]!) !== null);
  const bps = funds.map((f) => (pct[f.id] === "" ? 0 : parsePercentToBp(pct[f.id] ?? "")));
  const invalid = bps.some((b) => b === null);
  const sum = bps.reduce<number>((a, b) => a + (b ?? 0), 0);
  const step2Ok = !invalid && sum > 0 && sum <= 10000;

  // Plan guardado → tercer paso (primer gasto fijo); gasto fijo guardado → Inicio
  useEffect(() => {
    if (!state.ok) return;
    const t = setTimeout(() => setStep(3), 500);
    return () => clearTimeout(t);
  }, [state.ok]);
  useEffect(() => {
    if (!fixedState.ok) return;
    const t = setTimeout(() => setStep(4), 500);
    return () => clearTimeout(t);
  }, [fixedState.ok]);
  const leave = () => { router.replace("/inicio"); router.refresh(); };
  const skip = () => { if (step === 3) setStep(4); else leave(); };
  const TEMPLATES: { title: string; hint: string; list: { name: string; kind: "payroll" | "daily" | "savings" }[] }[] = [
    { title: "1 cuenta", hint: "Todo en una", list: [{ name: "Mi cuenta", kind: "daily" }] },
    { title: "Nómina + ahorro", hint: "Dos cuentas", list: [{ name: "Cuenta nómina", kind: "payroll" }, { name: "Cuenta ahorro", kind: "savings" }] },
    { title: "Nómina + día a día + ahorro", hint: "Tres cuentas", list: [{ name: "Cuenta nómina", kind: "payroll" }, { name: "Cuenta día a día", kind: "daily" }, { name: "Cuenta ahorro", kind: "savings" }] },
  ];
  const COLORS = ["#7DD3FC", "#FDBA74", "#A78BFA"];
  const createAccounts = async (list: { name: string; kind: "payroll" | "daily" | "savings" }[]) => {
    setAccBusy(true); setAccErr(null);
    for (const [i, a] of list.entries()) {
      const r = await saveAccount({ spaceId, name: x(a.name), bank: "", color: COLORS[i % COLORS.length]!, kind: a.kind, openingCents: 0, openingDate: new Date().toISOString().slice(0, 10), isDefault: i === 0 }).catch(() => null);
      if (!r?.ok) { setAccBusy(false); return setAccErr(r?.error ?? x("No se ha podido completar.")); }
    }
    setAccBusy(false); leave();
  };
  const fixedCents = parseToCents(fixed.amount) ?? 0;
  const submitFixed = () => {
    const d = Math.min(31, Math.max(1, Number(fixed.day) || 1));
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (now.getUTCDate() > d ? 1 : 0), 1));
    next.setUTCDate(Math.min(d, new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()));
    const fd = new FormData();
    fd.set("spaceId", spaceId); fd.set("description", fixed.description.trim()); fd.set("amount", fixed.amount); fd.set("frequency", "monthly"); fd.set("day", String(d)); fd.set("nextRun", next.toISOString().slice(0, 10));
    // Misma sugerencia de categoría que en la hoja de gasto: tus reglas primero y luego el diccionario (Spotify → Suscripciones)
    const byRule = matchRule(rules, fixed.description)?.categoryId ?? null;
    const cat = byRule && categories.some((c) => c.id === byRule) ? byRule : suggestCategory(fixed.description, categories);
    if (cat) fd.set("categoryId", cat);
    startTransition(() => fixedAction(fd));
  };

  const submit = () => {
    const fd = new FormData();
    fd.set("spaceId", spaceId); fd.set("month", month);
    for (const m of members) fd.set(`inc_${m.id}`, income[m.id] ?? "");
    for (const f of funds) { if ((pct[f.id] ?? "") !== "") { fd.set(`mode_${f.id}`, "percent"); fd.set(`val_${f.id}`, pct[f.id]!); } }
    startTransition(() => formAction(fd));
  };

  return (
    <section className="flex flex-col gap-5 pt-2" aria-labelledby="welcome-title">
      <p className="text-sm text-ink-3" aria-live="polite">{x("Paso")} {step} {x("de")} 4</p>
      <h1 id="welcome-title" className="text-2xl font-bold">{step === 1 ? x("¿Cuánto ingresas este mes?") : step === 2 ? x("Tu plan sugerido") : step === 3 ? x("Tu primer gasto fijo") : x("¿Cuántas cuentas usas?")}</h1>

      {step === 1 ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (step1Ok) setStep(2); }}>
          <p className="text-sm text-ink-2">{x("Suma nómina y otros ingresos. Es una estimación: puedes cambiarla después.")}</p>
          {members.map((m) => (
            <label key={m.id} className="flex flex-col gap-1.5 text-sm text-ink-2">
              {m.mine ? x("Tus ingresos") : `${x("Ingresos de")} ${m.name} (${x("opcional")})`}
              <input inputMode="decimal" value={income[m.id] ?? ""} onChange={(e) => setIncome({ ...income, [m.id]: e.target.value })} placeholder="1.800,00"
                aria-label={m.mine ? x("Tus ingresos") : `${x("Ingresos de")} ${m.name}`} autoFocus={m.mine}
                className="min-h-12 rounded-card border border-border bg-surface px-4 font-mono text-lg text-ink" />
            </label>
          ))}
          <button type="submit" disabled={!step1Ok} className="min-h-12 rounded-full bg-accent px-6 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">{x("Siguiente")}</button>
        </form>
      ) : step === 4 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">{x("Opcional. Fifti no se conecta a tu banco: usa las cuentas para saber cuánto hay en cada una y repartir tu nómina.")}</p>
          {TEMPLATES.map((t) => (
            <button key={t.title} type="button" disabled={accBusy} onClick={() => void createAccounts(t.list)} className="flex min-h-16 flex-col items-start justify-center rounded-card border border-border bg-surface px-4 text-left disabled:opacity-60">
              <span className="font-semibold">{x(t.title)}</span><span className="text-xs text-ink-3">{x(t.hint)}</span>
            </button>
          ))}
          {accErr && <p role="alert" className="text-sm text-over-text">{accErr}</p>}
        </div>
      ) : step === 3 ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (fixed.description.trim() && fixedCents > 0) submitFixed(); }}>
          <p className="text-sm text-ink-2">{x("Alquiler, luz, una suscripción… Lo apuntamos cada mes y te avisamos antes de que llegue. Puedes añadir más después en Plan.")}</p>
          <input value={fixed.description} onChange={(e) => setFixed({ ...fixed, description: e.target.value })} maxLength={120} placeholder={x("Alquiler")} aria-label={x("Concepto")} className="min-h-12 rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3" />
          <input inputMode="decimal" value={fixed.amount} onChange={(e) => setFixed({ ...fixed, amount: e.target.value })} placeholder="650,00" aria-label={x("Importe")} className="min-h-12 rounded-card border border-border bg-surface px-4 font-mono text-lg text-ink" />
          <label className="flex items-center justify-between gap-3 text-sm text-ink-2">{x("Día del mes")}
            <input type="number" min={1} max={31} value={fixed.day} onChange={(e) => setFixed({ ...fixed, day: e.target.value })} aria-label={x("Día del mes")} className="min-h-12 w-24 rounded-card border border-border bg-surface px-3 text-center font-mono text-ink" /></label>
          {fixedState.error && <p role="alert" className="text-sm text-over-text">{fixedState.error}</p>}
          {fixedState.ok && <p role="status" className="text-sm text-ink-2">{x("Gasto fijo guardado.")}</p>}
          <button type="submit" disabled={!fixed.description.trim() || fixedCents <= 0 || fixedPending || !!fixedState.ok} className="min-h-12 rounded-full bg-accent px-6 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">{fixedPending ? x("Guardando…") : x("Guardar y terminar")}</button>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (step2Ok) submit(); }}>
          <p className="text-sm text-ink-2">{x("Una propuesta de partida: 50 % fijos, 30 % día a día y ocio, 20 % ahorro. Edítala a tu gusto.")}</p>
          <ul className="flex flex-col gap-2">
            {funds.map((f, i) => (
              <li key={f.id} className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2 truncate"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</span>
                  <span className="money font-mono text-xs text-ink-3">{formatMoney(Math.round((total * (bps[i] ?? 0)) / 10000), currency, x.locale)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <input inputMode="decimal" value={pct[f.id] ?? ""} onChange={(e) => setPct({ ...pct, [f.id]: e.target.value })} placeholder="0" aria-label={`${f.name} %`}
                    className="min-h-11 w-20 rounded-card border border-border bg-surface-2 px-3 text-right font-mono text-ink" /> %
                </span>
              </li>
            ))}
          </ul>
          <p className={`text-sm ${sum > 10000 || invalid ? "text-over-text" : "text-ink-2"}`} role={sum > 10000 || invalid ? "alert" : undefined}>
            {invalid ? x("Porcentaje no válido") : sum > 10000 ? x("Los porcentajes superan el 100 %") : `${x("Sin asignar")}: ${((10000 - sum) / 100).toFixed(0)} %`}
          </p>
          {state.error && <p role="alert" className="text-sm text-over-text">{state.error}</p>}
          {state.ok && <p role="status" className="text-sm text-ink-2">{x("Plan guardado.")}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="min-h-12 rounded-full border border-border px-6 font-semibold">{x("Atrás")}</button>
            <button type="submit" disabled={!step2Ok || pending || !!state.ok} className="min-h-12 flex-1 rounded-full bg-accent px-6 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">{pending ? x("Guardando…") : x("Guardar plan")}</button>
          </div>
        </form>
      )}
      <button type="button" onClick={skip} className="min-h-11 self-center px-4 text-sm text-ink-2 underline-offset-4 hover:underline">{step === 3 ? x("Terminar sin gasto fijo") : step === 4 ? x("Saltar: lo haré después") : x("Saltar por ahora")}</button>
    </section>
  );
}
