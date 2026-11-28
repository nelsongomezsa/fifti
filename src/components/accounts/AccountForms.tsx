"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CurrencySelect } from "@/components/money/CurrencySelect";
import { SheetShell } from "@/components/ui/SheetShell";
import { useTx } from "@/i18n/tx-client";
import { currencySymbol, formatMoney, parseToCents } from "@/lib/money";
import { getFxPreview } from "@/server/actions/fx";
import { adjustBalance, archiveAccount, createTransfer, saveAccount } from "@/server/actions/accounts";

export type SpaceOpt = { id: string; name: string; kind: "personal" | "household" | "group"; currency: string };
export type AccountOpt = { id: string; name: string; color: string; kind: "payroll" | "daily" | "savings" | "shared"; balanceCents: number; mine: boolean; currency: string };
export type EditableAccount = { id: string; spaceId: string; name: string; bank: string | null; color: string; kind: AccountOpt["kind"]; openingCents: number; openingDate: string; isDefault: boolean; currency: string };

// Paleta de marca (sin rojo: se asocia a alarma o deuda)
const COLORS = ["#A78BFA", "#C8F060", "#7DD3FC", "#FF9F43", "#34D399", "#F472B6", "#FDBA74", "#9AA3AF"];
const KINDS: { id: AccountOpt["kind"]; label: string }[] = [{ id: "payroll", label: "Nómina" }, { id: "daily", label: "Día a día" }, { id: "savings", label: "Ahorro" }, { id: "shared", label: "Común" }];
const FIELD = "min-h-12 w-full rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3";
const today = () => new Date().toISOString().slice(0, 10);
const toInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/** Botón + hoja para crear o editar una cuenta. Solo etiquetas y saldo inicial: nada de IBAN ni credenciales. */
export function AccountEditor({ spaces, account, label, demo, variant = "primary", usedColors = [] }: { usedColors?: string[]; spaces: SpaceOpt[]; account?: EditableAccount; label: string; demo: boolean; variant?: "primary" | "plain" }) {
  const x = useTx();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account?.name ?? "");
  const [bank, setBank] = useState(account?.bank ?? "");
  const [color, setColor] = useState(account?.color ?? COLORS.find((c) => !usedColors.includes(c)) ?? COLORS[0]!);
  const [kind, setKind] = useState<AccountOpt["kind"]>(account?.kind ?? "daily");
  const [spaceId, setSpaceId] = useState(account?.spaceId ?? spaces[0]?.id ?? "");
  const [opening, setOpening] = useState(account ? toInput(account.openingCents) : "");
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? today());
  const [isDefault, setIsDefault] = useState(account?.isDefault ?? false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const space = spaces.find((s) => s.id === spaceId);
  const [chosenCurrency, setCurrency] = useState<string | null>(account?.currency ?? null);
  const currency = chosenCurrency ?? space?.currency ?? "EUR";
  const kinds =space?.kind === "personal" ? KINDS.filter((k) => k.id !== "shared") : KINDS;

  const submit = () => {
    setErr(null);
    if (demo) return setErr(x("Crea una cuenta para guardar"));
    const neg = opening.trim().startsWith("-");
    const c = opening.trim() ? parseToCents(opening.replace("-", "")) : 0;
    if (c === null || !name.trim()) return setErr(x("Datos no válidos"));
    start(async () => {
      const r = await saveAccount({ id: account?.id, spaceId, name: name.trim(), bank: bank.trim(), color, kind, openingCents: neg ? -c : c, openingDate, isDefault, currency }).catch(() => null);
      if (!r || !r.ok) return setErr(r?.error ?? x("No se ha podido completar."));
      setOpen(false); router.refresh();
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={variant === "primary" ? "inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent" : "inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold"}>{label}</button>
      {open && (
        <SheetShell onClose={() => setOpen(false)} label={label}>
          <h2 className="mb-3 text-xl font-bold">{label}</h2>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={x("Nombre (Santander nómina)")} aria-label={x("Nombre")} className={FIELD} />
            <input value={bank} onChange={(e) => setBank(e.target.value)} maxLength={60} placeholder={x("Banco (opcional)")} aria-label={x("Banco")} className={FIELD} />
            <div role="group" aria-label={x("Tipo")} className="grid grid-cols-4 gap-2">
              {kinds.map((k) => <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)} className={`min-h-11 rounded-full border px-1 text-sm font-medium ${kind === k.id ? "border-accent bg-accent text-on-accent" : "border-border text-ink-2"}`}>{x(k.label)}</button>)}
            </div>
            {!account && spaces.length > 1 && (
              <label className="flex flex-col gap-1 text-sm text-ink-2">{x("Espacio")}
                <select value={spaceId} onChange={(e) => { setSpaceId(e.target.value); if (spaces.find((s) => s.id === e.target.value)?.kind === "personal" && kind === "shared") setKind("daily"); }} className={FIELD}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.kind === "personal" ? x("Personal") : s.name}</option>)}</select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm text-ink-2">{x("Moneda de la cuenta")}
              <CurrencySelect value={currency} onChange={(e) => setCurrency(e.target.value)} className={FIELD} />
            </label>
            <div role="group" aria-label={x("Color")} className="flex flex-wrap gap-2">
              {COLORS.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} className={`size-11 rounded-full border-2 ${color === c ? "border-ink" : "border-transparent"}`} style={{ background: c }} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm text-ink-2">{x("Saldo inicial")}<input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0,00" className={`${FIELD} font-mono`} /></label>
              <label className="flex flex-col gap-1 text-sm text-ink-2">{x("A fecha de")}<input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className={FIELD} /></label>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />{x("Cuenta por defecto")}</label>
            {err && <p role="alert" className="text-sm text-over-text">{err}</p>}
            <button type="submit" disabled={pending || !name.trim()} className="min-h-12 rounded-full bg-accent font-semibold text-on-accent disabled:opacity-50">{pending ? x("Guardando…") : x("Guardar")}</button>
            {account && (
              <button type="button" disabled={pending} onClick={() => start(async () => { const r = await archiveAccount({ id: account.id, archived: true }).catch(() => null); if (r?.ok) { setOpen(false); router.refresh(); } else setErr(r?.error ?? x("No se ha podido completar.")); })} className="min-h-12 rounded-full border border-border font-semibold">{x("Archivar cuenta")}</button>
            )}
          </form>
        </SheetShell>
      )}
    </>
  );
}

/** Traspaso entre cuentas. No es gasto ni ingreso: solo mueve saldo (a la cuenta común de un hogar cuenta como aportación). */
export function TransferForm({ accounts, spaces = [], usedColors = [], demo, initial }: { usedColors?: string[]; accounts: AccountOpt[]; spaces?: SpaceOpt[]; demo: boolean; initial?: { from?: string; to?: string; cents?: number; source?: "manual" | "payroll_split" } }) {
  const x = useTx();
  const router = useRouter();
  const mine = accounts.filter((a) => a.mine);
  const [from, setFrom] = useState(initial?.from ?? mine[0]?.id ?? "");
  const [to, setTo] = useState(initial?.to ?? accounts.find((a) => a.id !== (initial?.from ?? mine[0]?.id))?.id ?? "");
  const [amount, setAmount] = useState(initial?.cents ? toInput(initial.cents) : "");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const cents = parseToCents(amount) ?? 0;
  const dest = accounts.find((a) => a.id === to);
  const fromCurrency = accounts.find((a) => a.id === from)?.currency ?? "EUR";
  const toCurrency = dest?.currency ?? fromCurrency;
  const crossCurrency = fromCurrency !== toCurrency;
  const fmt = (c: number) => formatMoney(c, fromCurrency, x.locale);

  // Entre monedas distintas se propone lo que llega con el cambio del día, pero se puede corregir (el banco aplica el suyo)
  const [typedArrives, setArrives] = useState<string | null>(null);
  const [rate, setRate] = useState<{ key: string; value: number | null } | null>(null);
  const rateKey = `${fromCurrency}|${toCurrency}|${date}`;
  useEffect(() => {
    if (!crossCurrency) return;
    let live = true;
    getFxPreview(toCurrency, fromCurrency, date).then((value) => { if (live) setRate({ key: rateKey, value }); }).catch(() => { if (live) setRate({ key: rateKey, value: null }); });
    return () => { live = false; };
  }, [crossCurrency, fromCurrency, toCurrency, date, rateKey]);
  const todayRate = rate?.key === rateKey ? rate.value : null;
  const arrives = typedArrives ?? (todayRate && cents > 0 ? toInput(Math.round(cents * todayRate)) : "");
  const arrivesCents = parseToCents(arrives) ?? 0;
  const ready = cents > 0 && !!from && !!to && (!crossCurrency || arrivesCents > 0);

  if (accounts.length < 2) return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-4">
      <p className="text-sm text-ink-2">{x("Necesitas al menos dos cuentas para traspasar.")}</p>
      {spaces.length > 0 && <AccountEditor spaces={spaces} label={x("Crear cuenta")} demo={demo} usedColors={usedColors} />}
    </div>
  );
  const save = () => {
    if (demo) return setMsg({ ok: false, text: x("Crea una cuenta para guardar") });
    setMsg({ ok: true, text: `${fmt(cents)} ${x("traspasados")}` }); // optimista
    start(async () => {
      const r = await createTransfer({ fromId: from, toId: to, amountCents: cents, date, note: note.trim() || undefined, source: initial?.source ?? "manual", ...(crossCurrency ? { toAmountCents: arrivesCents } : {}) }).catch(() => null);
      if (!r || !r.ok) return setMsg({ ok: false, text: r?.error ?? x("No se ha podido completar.") });
      setAmount(""); setArrives(null); setNote(""); router.refresh();
    });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) save(); }}>
      <div className="flex items-baseline gap-2 rounded-card border border-border bg-surface px-4 py-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent">
        <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setMsg(null); }} placeholder="0,00" aria-label={x("Importe")} autoFocus className="t-display w-full min-w-0 border-0 bg-transparent p-0 text-ink !outline-none placeholder:text-ink-3" />
        <span className="t-figure text-ink-3">{currencySymbol(fromCurrency, x.locale)}</span>
      </div>
      <label className="flex flex-col gap-1 text-sm text-ink-2">{x("De la cuenta")}
        <select value={from} onChange={(e) => { setFrom(e.target.value); setArrives(null); }} className={FIELD}>{mine.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-2">{x("A la cuenta")}
        <select value={to} onChange={(e) => { setTo(e.target.value); setArrives(null); }} className={FIELD}>{accounts.filter((a) => a.id !== from).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select>
      </label>
      {crossCurrency && (
        <label className="flex flex-col gap-1 text-sm text-ink-2">{`${x("Importe que llega")} (${toCurrency})`}
          <input inputMode="decimal" value={arrives} onChange={(e) => { setArrives(e.target.value); setMsg(null); }} placeholder="0,00" aria-label={x("Importe que llega")} className={`${FIELD} font-mono`} />
          <span className="text-xs text-ink-3">{todayRate ? x("Propuesto con el cambio del día. Pon lo que de verdad llegó: tu banco aplica el suyo.") : x("Pon lo que llega a la otra cuenta.")}</span>
        </label>
      )}
      {dest?.kind === "shared" && <p className="text-sm text-ink-2">{x("Es la cuenta común de un hogar: contará como tu aportación al hogar.")}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm text-ink-2">{x("Fecha")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} /></label>
        <label className="flex flex-col gap-1 text-sm text-ink-2">{x("Nota")}<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} className={FIELD} /></label>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ink-2" : "text-over-text"}`}>{msg.text}</p>}
      <button type="submit" disabled={!ready || pending} className="min-h-14 rounded-full bg-accent text-base font-semibold text-on-accent disabled:opacity-50">{pending ? x("Guardando…") : x("Hacer traspaso")}</button>
    </form>
  );
}

/** Ajustar saldo: crea un ajuste visible por la diferencia con el saldo del banco; no borra nada. */
export function AdjustBalance({ accountId, balanceCents, demo }: { accountId: string; balanceCents: number; demo: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(toInput(balanceCents));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const neg = target.trim().startsWith("-");
  const c = parseToCents(target.replace("-", ""));
  const submit = () => {
    if (demo) return setErr(x("Crea una cuenta para guardar"));
    if (c === null) return setErr(x("Datos no válidos"));
    start(async () => {
      const r = await adjustBalance({ accountId, targetCents: neg ? -c : c, note: x("Ajuste de saldo") }).catch(() => null);
      if (!r || !r.ok) return setErr(r?.error ?? x("No se ha podido completar."));
      setOpen(false); router.refresh();
    });
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="min-h-11 rounded-full border border-border px-4 text-sm font-semibold">{x("Ajustar saldo")}</button>
      {open && (
        <SheetShell onClose={() => setOpen(false)} label={x("Ajustar saldo")}>
          <h2 className="mb-1 text-xl font-bold">{x("Ajustar saldo")}</h2>
          <p className="mb-3 text-sm text-ink-2">{x("Escribe el saldo que ves en tu banco. Fifti añade un ajuste visible por la diferencia; no borra nada.")}</p>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} aria-label={x("Saldo actual")} className={`${FIELD} font-mono`} />
            {err && <p role="alert" className="text-sm text-over-text">{err}</p>}
            <button type="submit" disabled={pending} className="min-h-12 rounded-full bg-accent font-semibold text-on-accent disabled:opacity-50">{pending ? x("Guardando…") : x("Guardar ajuste")}</button>
          </form>
        </SheetShell>
      )}
    </>
  );
}
