"use client";

import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { useTx } from "@/i18n/tx-client";
import { nextOccurrence, type NewFrequency } from "@/lib/calendar";
import { formatMoney, parseToCents } from "@/lib/money";
import { suggestCategory } from "@/lib/nl/parse";
import { matchRule, type CategoryRule } from "@/lib/rules/match";
import { deleteRecurringAndGo, saveRecurring } from "@/server/actions/plan";

const FREQS: { id: NewFrequency; label: string; every: string }[] = [
  { id: "monthly", label: "Mensual", every: "Cada mes" }, { id: "weekly", label: "Semanal", every: "Cada semana" },
  { id: "quarterly", label: "Trimestral", every: "Cada trimestre" }, { id: "yearly", label: "Anual", every: "Cada año" },
];
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const FIELD = "min-h-12 w-full rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3";

/** Nuevo gasto fijo: importe grande, concepto con categoría sugerida, frecuencia, día de cobro tocando un número y próximo cobro calculado. */
export function NewFixedExpense({ spaceId, categories, rules, notify, initial, accounts = [] }: { accounts?: { id: string; name: string; isDefault: boolean }[]; spaceId: string; categories: { id: string; name: string }[]; rules: CategoryRule[]; notify: { on: boolean; days: number }; initial?: { id: string; description: string; cents: number; freq: NewFrequency; day: number; category: string } }) {
  const x = useTx();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState(initial ? (initial.cents / 100).toFixed(2).replace(".", ",") : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [freq, setFreq] = useState<NewFrequency>(initial?.freq ?? "monthly");
  const [day, setDay] = useState(() => initial?.day ?? Math.min(28, new Date().getUTCDate()));
  const [month, setMonth] = useState(new Date().getUTCMonth() + 1);
  const [category, setCategory] = useState(initial?.category ?? "");
  const [touched, setTouched] = useState(!!initial);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.isDefault)?.id ?? "");
  const [state, formAction, pending] = useActionState(saveRecurring, {});

  const cents = parseToCents(amount) ?? 0;
  const next = nextOccurrence(freq, day, today, month);
  const nextLabel = new Date(`${next}T00:00:00Z`).toLocaleDateString(x.locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
  const every = FREQS.find((f) => f.id === freq)!.every;
  const valid = cents > 0 && description.trim().length > 0;

  const onDescription = (text: string) => {
    setDescription(text);
    if (touched) return;
    const byRule = matchRule(rules, text)?.categoryId ?? null;
    setCategory((byRule && categories.some((c) => c.id === byRule) ? byRule : suggestCategory(text, categories)) ?? "");
  };
  const changeFreq = (f: NewFrequency) => { setFreq(f); if (f === "weekly") setDay(((new Date().getUTCDay() + 6) % 7) + 1); else if (freq === "weekly") setDay(Math.min(28, new Date().getUTCDate())); };

  useEffect(() => { if (state.ok) router.replace("/plan?vista=fijos"); }, [state.ok, router]);

  const remove = (id: string) => {
    setDeleting(true); setDelError(null);
    startTransition(async () => {
      try {
        const r = await deleteRecurringAndGo(id);
        setDelError(r.error); setDeleting(false);
      } catch (err) {
        unstable_rethrow(err); // la redirección la gestiona el router
        setDelError(x("No se ha podido completar.")); setDeleting(false);
      }
    });
  };

  const submit = () => {
    const fd = new FormData();
    if (initial) fd.set("id", initial.id);
    if (accounts.length > 0) fd.set("accountId", accountId);
    fd.set("spaceId", spaceId); fd.set("description", description.trim()); fd.set("amount", amount); fd.set("frequency", freq);
    fd.set("day", String(day)); fd.set("nextRun", next); if (category) fd.set("categoryId", category);
    startTransition(() => formAction(fd));
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (valid) submit(); }}>
      <div>
        <p className="t-label">{x(every)}</p>
        <div className="mt-1 flex items-baseline gap-2 rounded-card border border-border bg-surface px-4 py-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" aria-label={x("Importe")} autoFocus
            className="t-display w-full min-w-0 border-0 bg-transparent p-0 text-ink !outline-none placeholder:text-ink-3" />
          <span className="t-figure text-ink-3">€</span>
        </div>
        {cents > 0 && <p className="money text-xs text-ink-3">{formatMoney(cents, "EUR", x.locale)}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <input value={description} onChange={(e) => onDescription(e.target.value)} maxLength={120} placeholder={x("Concepto")} aria-label={x("Concepto")} className={FIELD} />
        <label className="relative inline-flex min-h-11 w-fit max-w-full items-center gap-2 rounded-full border border-border bg-surface-2 px-4 text-sm focus-within:ring-2 focus-within:ring-accent">
          <span className="text-ink-3">{category && !touched ? x("Sugerida") : x("Categoría")}:</span>
          <span className="truncate font-medium text-ink">{categories.find((c) => c.id === category)?.name ?? x("Sin categoría")}</span>
          <span aria-hidden className="text-ink-3">▾</span>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setTouched(true); }} aria-label={x("Categoría")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
            <option value="">{x("Sin categoría")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      <div role="group" aria-label={x("Frecuencia")} className="grid grid-cols-4 gap-2">
        {FREQS.map((f) => (
          <button key={f.id} type="button" aria-pressed={freq === f.id} onClick={() => changeFreq(f.id)}
            className={`min-h-11 rounded-full border px-1 text-sm font-medium ${freq === f.id ? "border-accent bg-accent text-on-accent" : "border-border text-ink-2"}`}>{x(f.label)}</button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <p className="t-label">{freq === "weekly" ? x("Día de la semana") : x("Día del cobro")}</p>
        {freq === "yearly" && (
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label={x("Mes")} className={FIELD}>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(Date.UTC(2026, i, 1)).toLocaleDateString(x.locale, { month: "long", timeZone: "UTC" })}</option>)}
          </select>
        )}
        {freq === "weekly" ? (
          <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={x("Día de la semana")}>
            {WEEKDAYS.map((w, i) => <button key={w} type="button" aria-pressed={day === i + 1} onClick={() => setDay(i + 1)} className={`min-h-11 rounded-card border font-mono text-sm ${day === i + 1 ? "border-accent bg-accent text-on-accent" : "border-border text-ink-2"}`}>{x(w)}</button>)}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5" role="group" aria-label={x("Día del cobro")}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <button key={d} type="button" aria-pressed={day === d} onClick={() => setDay(d)} className={`min-h-11 rounded-card border font-mono text-sm ${day === d ? "border-accent bg-accent text-on-accent" : "border-border text-ink-2"}`}>{d}</button>)}
          </div>
        )}
        <p className="text-sm text-ink-2" aria-live="polite">{x("Próximo cobro")}: <strong className="text-ink first-letter:uppercase">{nextLabel}</strong></p>
      </div>

      {accounts.length > 1 && (
        <label className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 text-sm font-medium">{x("Cuenta")}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="min-h-11 max-w-[60%] rounded-card border border-border bg-surface-2 px-3 text-ink">
            <option value="">{x("Sin cuenta")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <div className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4">
        <span className="min-w-0"><span className="block text-sm font-medium">{x("Avisarme antes")}</span>
          <span className="block text-xs text-ink-3">{notify.on ? `${notify.days} ${notify.days === 1 ? x("día") : x("días")} ${x("de antelación")}` : x("Desactivado en Notificaciones")} · <Link href="/ajustes#notificaciones" className="underline">{x("Cambiar")}</Link></span></span>
        <span role="img" aria-label={notify.on ? x("Activado") : x("Desactivado")} className={`h-7 w-12 shrink-0 rounded-full p-0.5 ${notify.on ? "bg-accent" : "bg-track"}`}><span className={`block size-6 rounded-full bg-bg transition-transform ${notify.on ? "translate-x-5" : ""}`} /></span>
      </div>

      {pending && <p role="status" className="text-sm text-ink-2">✓ {x("Gasto fijo guardado.")}</p>}
      {initial && (
        <div className="rounded-card border border-over p-4">
          {!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)} className="min-h-12 w-full rounded-full border border-over font-semibold text-over-text">{x("Borrar gasto fijo")}</button>
          ) : (
            <div role="alertdialog" aria-label={x("¿Borrar este gasto fijo?")} className="flex flex-col gap-3">
              <p className="text-sm text-ink-2">{x("¿Borrar este gasto fijo?")} {x("Dejará de apuntarse cada mes. Los gastos ya apuntados se conservan.")}</p>
              {delError && <p role="alert" className="text-sm text-over-text">{delError}</p>}
              <div className="flex gap-2">
                <button type="button" disabled={deleting} onClick={() => setConfirmDel(false)} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
                <button type="button" disabled={deleting} onClick={() => remove(initial.id)} className="min-h-12 flex-1 rounded-full bg-over font-semibold text-on-accent disabled:opacity-60">{deleting ? x("Borrando…") : x("Borrar")}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {state.error && !pending && <p role="alert" className="text-sm text-over-text">{state.error}</p>}
      <button type="submit" disabled={!valid || pending || !!state.ok} className="min-h-14 rounded-full bg-accent px-6 text-base font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">{initial ? x("Guardar cambios") : x("Guardar gasto fijo")}</button>
    </form>
  );
}
