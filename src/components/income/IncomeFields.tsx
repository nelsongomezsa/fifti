"use client";

import { useEffect, useRef, useState } from "react";
import { CurrencySelect } from "@/components/money/CurrencySelect";
import { useTx } from "@/i18n/tx-client";
import { PAY_FREQUENCIES, isoWeekday, type PayFrequency } from "@/lib/paydays";

const FIELD = "min-h-12 w-full rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3";
const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

type Frequency = "once" | PayFrequency;
export type IncomeInitial = { amount: string; currency: string; source: string; date: string; frequency: Frequency; day: number; accountId: string | null; memberId: string };

/**
 * Campos de un ingreso. `payment` es un cobro concreto de una serie (sin frecuencia: se cambia solo ese) y
 * `rule` la serie en sí (sin «Solo una vez»).
 */
export function IncomeFields({ members, accounts, initial, kind = "new" }: {
  members: { id: string; name: string }[];
  accounts: { id: string; name: string; currency: string }[];
  initial: IncomeInitial;
  kind?: "new" | "edit" | "payment" | "rule";
}) {
  const x = useTx();
  const [frequency, setFrequency] = useState<Frequency>(initial.frequency);
  const [date, setDate] = useState(initial.date);
  const [day, setDay] = useState(String(initial.day));
  const [accountId, setAccountId] = useState(initial.accountId ?? "");
  const [currency, setCurrency] = useState(initial.currency);
  const [chosen, setChosen] = useState(kind !== "new");
  const root = useRef<HTMLDivElement>(null);

  // Al guardar, el formulario se vacía: los campos controlados vuelven también a su valor inicial
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form || kind !== "new") return;
    const reset = () => { setFrequency(initial.frequency); setDate(initial.date); setDay(String(initial.day)); setAccountId(initial.accountId ?? ""); setCurrency(initial.currency); setChosen(false); };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initial, kind]);

  const pickAccount = (id: string) => {
    setAccountId(id);
    // La moneda sigue a la cuenta mientras no se haya elegido otra a mano
    const account = accounts.find((a) => a.id === id);
    if (!chosen && account) setCurrency(account.currency);
  };
  const weekly = frequency === "weekly" || frequency === "biweekly";
  const pickWeekday = (wanted: number) => {
    const add = (wanted - isoWeekday(date) + 7) % 7;
    setDate(new Date(Date.parse(`${date}T00:00:00Z`) + add * 86400000).toISOString().slice(0, 10));
  };
  const label = "flex flex-col gap-1 text-xs text-ink-3";

  return (
    <div ref={root} className="flex flex-col gap-3">
      <select name="memberId" aria-label={x("Persona")} className={FIELD} defaultValue={initial.memberId}>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <div className="flex gap-2">
        <input name="amount" inputMode="decimal" required defaultValue={initial.amount} placeholder={x("Importe (1.800,00)")} aria-label={x("Importe")} className={`${FIELD} min-w-0 flex-1 font-mono`} />
        <CurrencySelect name="currency" value={currency} onChange={(e) => { setCurrency(e.target.value); setChosen(true); }} aria-label={x("Moneda del ingreso")} className="min-h-12 w-28 shrink-0 rounded-card border border-border bg-surface px-2 text-sm text-ink" />
      </div>
      <input name="source" defaultValue={initial.source} maxLength={60} aria-label={x("Origen")} className={FIELD} />
      {accounts.length > 0 && (
        <select name="accountId" aria-label={x("Cuenta")} className={FIELD} value={accountId} onChange={(e) => pickAccount(e.target.value)}>
          <option value="">{x("Sin cuenta")}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      )}
      {kind === "payment" ? (
        <p className="text-xs text-ink-3">{x("Cambias solo este cobro. La serie se edita en «Ingresos que se repiten».")}</p>
      ) : (
        <select name="frequency" aria-label={x("Frecuencia")} className={FIELD} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
          {kind !== "rule" && <option value="once">{x("Solo una vez")}</option>}
          {PAY_FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{x(f.label)}</option>)}
        </select>
      )}
      {weekly && (
        <label className={label}>{x("Día de la semana")}
          <select value={isoWeekday(date)} onChange={(e) => pickWeekday(Number(e.target.value))} className={FIELD}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{x(d)}</option>)}
          </select>
        </label>
      )}
      {frequency === "monthly" ? (
        <>
          <label className={label}>{x("Día del mes")}
            <input name="day" type="number" inputMode="numeric" min={1} max={31} required value={day} onChange={(e) => setDay(e.target.value)} className={FIELD} />
          </label>
          <p className="text-xs text-ink-3">{x("Si el mes no tiene ese día, se usa el último.")}</p>
          <input type="hidden" name="receivedAt" value={date} />
        </>
      ) : (
        <label className={label}>{frequency === "once" ? x("Fecha") : kind === "rule" ? x("Próximo cobro") : x("Primer cobro")}
          <input name="receivedAt" type="date" required value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} className={FIELD} />
        </label>
      )}
    </div>
  );
}
