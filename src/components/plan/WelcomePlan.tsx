"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTx } from "@/i18n/tx-client";
import { formatMoney, parseToCents } from "@/lib/money";
import { parsePercentToBp } from "@/lib/validation/spaces";
import { savePlan } from "@/server/actions/plan";

type Member = { id: string; name: string; mine: boolean };
type Fund = { id: string; name: string; color: string; suggested: number | null };

/** Bienvenida en 2 pasos: ingresos del mes y plan sugerido editable. Se guarda con la misma acción (y validación) que el plan normal. */
export function WelcomePlan({ spaceId, month, currency, members, funds }: { spaceId: string; month: string; currency: string; members: Member[]; funds: Fund[] }) {
  const x = useTx();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
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

  useEffect(() => {
    if (!state.ok) return;
    const t = setTimeout(() => { router.replace("/inicio"); router.refresh(); }, 600);
    return () => clearTimeout(t);
  }, [state.ok, router]);

  const submit = () => {
    const fd = new FormData();
    fd.set("spaceId", spaceId); fd.set("month", month);
    for (const m of members) fd.set(`inc_${m.id}`, income[m.id] ?? "");
    for (const f of funds) { if ((pct[f.id] ?? "") !== "") { fd.set(`mode_${f.id}`, "percent"); fd.set(`val_${f.id}`, pct[f.id]!); } }
    startTransition(() => formAction(fd));
  };

  return (
    <section className="flex flex-col gap-5 pt-2" aria-labelledby="welcome-title">
      <p className="text-sm text-ink-3" aria-live="polite">{x("Paso")} {step} {x("de")} 2</p>
      <h1 id="welcome-title" className="text-2xl font-bold">{step === 1 ? x("¿Cuánto ingresas este mes?") : x("Tu plan sugerido")}</h1>

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
    </section>
  );
}
