"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildSplits, formatMoney, parseToCents, BP_TOTAL, type SplitMode } from "@/lib/money";
import { parsePercentToBp } from "@/lib/validation/spaces";
import { submitExpense } from "@/lib/offline/submit";
import type { ExpenseInput } from "@/lib/validation/expense";
import type { SheetContext, SheetSpace } from "@/server/actions/sheet";
import { Keypad } from "./Keypad";

export type SheetPrefill = {
  spaceId?: string;
  amountCents?: number;
  categoryId?: string | null;
  description?: string;
  participants?: string[];
  payerId?: string;
  tags?: string;
  /** Edición de un gasto existente */
  edit?: { id: string; clientId: string; spentAt: string; paidFrom: "member" | "pot"; splitMode: SplitMode; isPrivate: boolean };
};

export type SavedInfo = { id: string; shareCents: number; spaceName: string; currency: string; pending?: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const LAST_KEY = "fifti:lastSpace";
const chip = (on: boolean) =>
  `min-h-11 whitespace-nowrap rounded-full border px-4 text-sm font-medium ${on ? "text-on-accent" : "border-border text-ink-2"}`;
const ACCENTS = { personal: "var(--lilac)", household: "var(--lime)", group: "var(--tangerine)" } as const;

export function ExpenseSheet({
  ctx, defaultSpaceId, prefill, onClose, onSaved,
}: {
  ctx: SheetContext; defaultSpaceId: string; prefill?: SheetPrefill; onClose: () => void; onSaved: (info: SavedInfo) => void;
}) {
  const initialSpace = useMemo(() => {
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_KEY); } catch { /* sin almacenamiento */ }
    const id = prefill?.spaceId ?? last ?? defaultSpaceId;
    return ctx.spaces.find((s) => s.id === id) ?? ctx.spaces.find((s) => s.id === defaultSpaceId) ?? ctx.spaces[0]!;
  }, [ctx.spaces, defaultSpaceId, prefill?.spaceId]);

  const [space, setSpace] = useState<SheetSpace>(initialSpace);
  const [amount, setAmount] = useState(prefill?.amountCents ? (prefill.amountCents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "") : "");
  const [desc, setDesc] = useState(prefill?.description ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(prefill?.categoryId ?? initialSpace.topCategoryId);
  const [date, setDate] = useState(prefill?.edit?.spentAt ?? today());
  const [payerId, setPayerId] = useState(prefill?.payerId ?? initialSpace.meId);
  const [multiPay, setMultiPay] = useState(false);
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<SplitMode>(prefill?.edit?.splitMode ?? "default");
  const [included, setIncluded] = useState<Set<string>>(new Set(prefill?.participants ?? initialSpace.members.map((m) => m.id)));
  const [pct, setPct] = useState<Record<string, string>>({});
  const [isPrivate, setIsPrivate] = useState(prefill?.edit?.isPrivate ?? false);
  const [fromPot, setFromPot] = useState(prefill?.edit?.paidFrom === "pot");
  const [tags, setTags] = useState(prefill?.tags ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = ({ key }: KeyboardEvent) => { if (key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const changeSpace = (s: SheetSpace) => {
    setSpace(s);
    setCategoryId(s.topCategoryId);
    setPayerId(s.meId);
    setIncluded(new Set(s.members.map((m) => m.id)));
    setMode("default"); setIsPrivate(false); setFromPot(false); setMultiPay(false);
  };

  const cents = parseToCents(amount) ?? 0;
  const isGroup = space.kind !== "personal";
  const participants = useMemo(() => space.members.filter((m) => included.has(m.id)), [space.members, included]);

  const live = useMemo(() => {
    if (cents <= 0) return { share: 0, error: null as string | null };
    if (!isGroup) return { share: cents, error: null };
    try {
      let custom;
      if (mode === "custom") {
        const values: Record<string, number> = {};
        for (const p of participants) {
          const bp = parsePercentToBp(pct[p.id] ?? "");
          if (bp === null) throw new RangeError("Pon un porcentaje válido para cada persona");
          values[p.id] = bp;
        }
        if (Object.values(values).reduce((a, b) => a + b, 0) !== BP_TOTAL) throw new RangeError("Los porcentajes deben sumar 100 %");
        custom = { kind: "percent" as const, values };
      }
      if (participants.length === 0) throw new RangeError("Elige al menos una persona");
      const s = buildSplits(cents, mode, participants.map((m) => ({ memberId: m.id, defaultBp: m.defaultBp })), custom);
      return { share: s.find((x) => x.memberId === space.meId)?.amountCents ?? 0, error: null };
    } catch (e) {
      return { share: 0, error: e instanceof RangeError ? e.message : "Reparto no válido" };
    }
  }, [cents, isGroup, mode, participants, pct, space.meId]);

  const save = async () => {
    setError(null);
    if (cents <= 0) return setError("Pon un importe.");
    if (!desc.trim()) return setError("Pon un concepto.");
    if (live.error) return setError(live.error);
    const payers = fromPot || !isGroup ? [] : multiPay
      ? space.members.filter((m) => parseToCents(payAmounts[m.id] ?? "")).map((m) => ({ memberId: m.id, amountCents: parseToCents(payAmounts[m.id] ?? "")! }))
      : [{ memberId: payerId }];
    const custom = mode === "custom"
      ? { kind: "percent" as const, values: Object.fromEntries(participants.map((p) => [p.id, parsePercentToBp(pct[p.id] ?? "") ?? 0])) }
      : undefined;
    const input: ExpenseInput = {
      id: prefill?.edit?.id, clientId: prefill?.edit?.clientId ?? crypto.randomUUID(), spaceId: space.id,
      description: desc.trim(), categoryId, spentAt: date, amountCents: cents, currency: space.currency,
      paidFrom: fromPot ? "pot" : "member", splitMode: mode, participants: participants.map((p) => p.id), custom,
      payers, isPrivate: isGroup && isPrivate,
      tags: tags.split(/[\s,#]+/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
    };
    setSaving(true);
    const res = await submitExpense(input);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    try { localStorage.setItem(LAST_KEY, space.id); } catch { /* sin almacenamiento */ }
    onSaved({ id: res.id, shareCents: res.shareCents, spaceName: space.kind === "personal" ? "Personal" : space.name, currency: space.currency, pending: res.id === "pending" });
    onClose();
  };

  const accent = ACCENTS[space.kind];
  const bubbleLabel = space.kind === "personal" ? "Personal" : space.name;
  const symbol = new Intl.NumberFormat("es-ES", { style: "currency", currency: space.currency }).formatToParts(0).find((p) => p.type === "currency")?.value;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Nuevo gasto"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[94dvh] w-full max-w-md overflow-y-auto rounded-t-[24px] border border-border bg-surface-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{prefill?.edit ? "Editar gasto" : "Nuevo gasto"}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid min-h-11 min-w-11 place-items-center text-ink-2">✕</button>
        </div>

        <p className="mb-1 text-xs text-ink-3">¿Dónde lo apunto?</p>
        <div className="mb-4 flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {ctx.spaces.map((s) => {
            const on = s.id === space.id;
            return (
              <button key={s.id} type="button" disabled={!!prefill?.edit} aria-pressed={on} onClick={() => changeSpace(s)}
                className={chip(on)} style={on ? { background: ACCENTS[s.kind], borderColor: ACCENTS[s.kind] } : undefined}>
                {s.kind === "personal" ? "Personal" : s.name}
              </button>
            );
          })}
        </div>

        <div className="mb-3 text-center">
          <output aria-live="polite" className="font-mono text-5xl font-semibold tabular-nums">
            {amount === "" ? "0" : amount} <span className="text-3xl text-ink-3">{symbol}</span>
          </output>
        </div>
        <input
          value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={120} placeholder="Concepto" aria-label="Concepto"
          className="mb-3 min-h-12 w-full rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3"
        />

        <div className="mb-3 flex gap-2 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Categoría">
          {space.categories.map((c) => {
            const on = c.id === categoryId;
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => setCategoryId(c.id)} className={chip(on)}
                style={on ? { background: accent, borderColor: accent } : undefined}>
                {c.name}
              </button>
            );
          })}
        </div>

        <Keypad value={amount} onChange={setAmount} />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-3">Fecha
            <input type="date" value={date} max="2100-01-01" onChange={(e) => setDate(e.target.value)}
              className="min-h-11 rounded-card border border-border bg-surface px-3 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-3">Etiquetas
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#cumple" maxLength={80}
              className="min-h-11 rounded-card border border-border bg-surface px-3 text-sm text-ink" />
          </label>
        </div>

        {isGroup ? (
          <div className="mt-4 flex flex-col gap-3 rounded-card border border-border bg-surface p-3">
            {space.kind === "household" && (
              <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2">
                <input type="checkbox" checked={fromPot} onChange={(e) => setFromPot(e.target.checked)} /> Pagado desde el bote común
              </label>
            )}
            {!fromPot && (
              <div className="flex flex-col gap-2">
                <label className="flex items-center justify-between gap-3 text-sm text-ink-2">
                  Pagó
                  <select value={payerId} disabled={multiPay} onChange={(e) => setPayerId(e.target.value)}
                    className="min-h-11 rounded-card border border-border bg-surface-2 px-3 text-ink">
                    {space.members.map((m) => <option key={m.id} value={m.id}>{m.id === space.meId ? "Yo" : m.name}</option>)}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2">
                  <input type="checkbox" checked={multiPay} onChange={(e) => setMultiPay(e.target.checked)} /> Pagaron varias personas
                </label>
                {multiPay && space.members.map((m) => (
                  <label key={m.id} className="flex items-center justify-between gap-3 text-sm text-ink-2">
                    {m.name}
                    <input inputMode="decimal" value={payAmounts[m.id] ?? ""} onChange={(e) => setPayAmounts({ ...payAmounts, [m.id]: e.target.value })}
                      placeholder="0,00" className="min-h-11 w-28 rounded-card border border-border bg-surface-2 px-3 text-right font-mono text-ink" />
                  </label>
                ))}
              </div>
            )}

            <div role="group" aria-label="Reparto" className="flex gap-2">
              {([["default", "Por defecto"], ["equal", "Iguales"], ["custom", "Personalizado"]] as const).map(([m, l]) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={chip(mode === m)}
                  style={mode === m ? { background: accent, borderColor: accent } : undefined}>{l}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quién participa">
              {space.members.map((m) => {
                const on = included.has(m.id);
                return (
                  <button key={m.id} type="button" aria-pressed={on} className={chip(on)}
                    style={on ? { background: "var(--track)", color: "var(--text)", borderColor: "var(--track)" } : undefined}
                    onClick={() => { const n = new Set(included); if (on) n.delete(m.id); else n.add(m.id); setIncluded(n); }}>
                    {on ? "✓ " : ""}{m.id === space.meId ? "Yo" : m.name}
                  </button>
                );
              })}
            </div>
            {mode === "custom" && participants.map((m) => (
              <label key={m.id} className="flex items-center justify-between gap-3 text-sm text-ink-2">
                {m.name}
                <span className="flex items-center gap-2">
                  <input inputMode="decimal" value={pct[m.id] ?? ""} onChange={(e) => setPct({ ...pct, [m.id]: e.target.value })}
                    placeholder="0" className="min-h-11 w-20 rounded-card border border-border bg-surface-2 px-3 text-right font-mono text-ink" /> %
                </span>
              </label>
            ))}
            <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              Gasto privado (los demás ven solo importe y reparto)
            </label>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-3">Solo lo ves tú.</p>
        )}

        <p className="mt-3 flex items-baseline justify-between text-sm text-ink-2" aria-live="polite">
          <span>Tu parte</span>
          <span className="font-mono text-lg text-ink">{formatMoney(live.share, space.currency)}</span>
        </p>
        {(error ?? (cents > 0 ? live.error : null)) && (
          <p role="alert" className="mt-1 text-sm text-over-text">{error ?? live.error}</p>
        )}

        <button type="button" onClick={save} disabled={saving}
          className="mt-4 min-h-14 w-full rounded-full text-base font-semibold text-on-accent disabled:opacity-60" style={{ background: accent }}>
          {saving ? "Guardando…" : `Guardar en ${bubbleLabel}`}
        </button>
      </div>
    </div>
  );
}
