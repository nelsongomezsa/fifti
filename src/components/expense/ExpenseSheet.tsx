"use client";


import type { RuleHint } from "@/server/actions/expenses";
import { matchRule } from "@/lib/rules/match";
import { parsePhrase, type NlResult } from "@/lib/nl/parse";
import { interpretPhrase } from "@/server/actions/phrase";
import { useTx } from "@/i18n/tx-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildSplits, currencySymbol, formatMoney, groupTyped, parseToCents, BP_TOTAL, type SplitMode } from "@/lib/money";
import { parsePercentToBp } from "@/lib/validation/spaces";
import { submitExpense } from "@/lib/offline/submit";
import { CURRENCIES } from "@/lib/fx";
import { getFxPreview } from "@/server/actions/fx";
import { scanReceipt } from "@/lib/ocr";
import { uploadReceipt } from "@/server/actions/receipts";
import type { ExpenseInput } from "@/lib/validation/expense";
import type { SheetContext, SheetSpace } from "@/server/actions/sheet";
import type { SaveResult } from "@/server/actions/expenses";
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

export type SavedInfo = { id: string; shareCents: number; spaceName: string; currency: string; pending?: boolean; ruleHint?: RuleHint };

const today = () => new Date().toISOString().slice(0, 10);
const LAST_KEY = "fifti:lastSpace";
const chip = (on: boolean) =>
  `min-h-11 whitespace-nowrap rounded-full border px-4 text-sm font-medium ${on ? "text-on-accent" : "border-border text-ink-2"}`;
const ACCENTS = { personal: "var(--lilac)", household: "var(--lime)", group: "var(--tangerine)" } as const;

export function ExpenseSheet({
  ctx, defaultSpaceId, prefill, onClose, onSaved, demo, optimistic,
}: {
  ctx: SheetContext; defaultSpaceId: string; prefill?: SheetPrefill; onClose: () => void; onSaved: (info: SavedInfo) => void;
  /** Modo demo: el gasto se entrega a este manejador (en memoria) y no se llama a ningún servidor. */
  demo?: { submit: (input: ExpenseInput) => Promise<SaveResult> };
  /** Guardado optimista: la hoja se cierra al instante y quien la abrió se encarga de enviar el gasto. */
  optimistic?: (input: ExpenseInput, info: { shareCents: number; baseCents: number; spaceName: string; currency: string }) => void;
}) {
  const x = useTx();
  const initialSpace = useMemo(() => {
    let last: string | null = null;
    if (!demo) { try { last = localStorage.getItem(LAST_KEY); } catch { /* sin almacenamiento */ } }
    const id = prefill?.spaceId ?? last ?? defaultSpaceId;
    return ctx.spaces.find((s) => s.id === id) ?? ctx.spaces.find((s) => s.id === defaultSpaceId) ?? ctx.spaces[0]!;
  }, [ctx.spaces, defaultSpaceId, prefill?.spaceId, demo]);

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
  const [currency, setCurrency] = useState(initialSpace.currency);
  const [fx, setFx] = useState<number | null>(1);
  const [photo, setPhoto] = useState<File | null>(null);
  const [scan, setScan] = useState<{ busy: boolean; amountCents: number | null; date: string | null; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // El error solo se ve mientras importe y concepto siguen como estaban al pulsar Guardar: al escribir desaparece
  const [errState, setErrState] = useState<{ msg: string; sig: string } | null>(null);
  const sig = `${amount}\u0000${desc}`;
  const error = errState && errState.sig === sig ? errState.msg : null;
  const setError = (m: string | null) => setErrState(m ? { msg: m, sig } : null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const catRow = useRef<HTMLDivElement>(null);
  // Categoría elegida a mano (o traída ya puesta): las reglas solo sugieren mientras no se haya tocado
  const [catTouched, setCatTouched] = useState(!!prefill?.categoryId || !!prefill?.edit);
  // Cuando una frase, una regla o un parámetro elige categoría, la fila se desplaza sola hasta dejarla visible
  useEffect(() => {
    catRow.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [categoryId, space.id]);
  const ruleMatch = useMemo(() => (catTouched ? null : matchRule(space.rules, desc)), [desc, space.rules, catTouched]);
  const ruleNote = ruleMatch ? `${ruleMatch.matchText} → ${space.categories.find((c) => c.id === ruleMatch.categoryId)?.name ?? ""}` : null;
  const onDesc = (v: string) => {
    setDesc(v);
    if (catTouched) return;
    const m = matchRule(space.rules, v);
    if (m && space.categories.some((c) => c.id === m.categoryId)) setCategoryId(m.categoryId);
  };
  const [phrase, setPhrase] = useState("");
  const [phraseBusy, setPhraseBusy] = useState(false);
  const [phraseNote, setPhraseNote] = useState<string | null>(null);

  /** Rellena la hoja con lo entendido de la frase. Nunca guarda: la persona revisa y pulsa Guardar. */
  const applyPhrase = (r: NlResult) => {
    const target = (r.spaceId && ctx.spaces.find((s) => s.id === r.spaceId)) || space;
    if (target.id !== space.id) changeSpace(target);
    if (r.amountCents) setAmount((r.amountCents / 100).toFixed(2).replace(".", ",").replace(/,00$/, ""));
    if (r.description) setDesc(r.description);
    if (r.categoryId) { setCatTouched(true); setCategoryId(r.categoryId); }
    if (r.splitMode === "equal" && r.participantIds?.length) { setMode("equal"); setIncluded(new Set(r.participantIds)); }
    setPhraseNote(r.recurring ? x("Parece un gasto recurrente: puedes crearlo como pago fijo en Calendario.") : null);
  };
  const runPhrase = async () => {
    const text = phrase.trim();
    if (!text || phraseBusy) return;
    setPhraseBusy(true); setPhraseNote(null);
    if (ctx.ai && !demo) {
      const r = await interpretPhrase({ phrase: text, currentSpaceId: space.id }).catch(() => null);
      if (r?.ok) { applyPhrase(r.result); if (r.note) setPhraseNote(r.note); }
      else setPhraseNote(r && !r.ok ? r.error : x("No se ha podido completar."));
    } else {
      const spaces = ctx.spaces.map((s) => ({ id: s.id, name: s.name, kind: s.kind, meId: s.meId, members: s.members, categories: s.categories, rules: s.rules }));
      applyPhrase(parsePhrase(text, spaces, space.id));
    }
    setPhraseBusy(false);
  };

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = ({ key }: KeyboardEvent) => { if (key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (demo || currency === space.currency) return;
    let live = true;
    getFxPreview(space.currency, currency, date).then((r) => { if (live) setFx(r); }).catch(() => { if (live) setFx(null); });
    return () => { live = false; };
  }, [currency, space.currency, date, demo]);

  const changeSpace = (s: SheetSpace) => {
    setCurrency(s.currency); setFx(1);
    setSpace(s);
    setCategoryId(s.topCategoryId);
    setPayerId(s.meId);
    setIncluded(new Set(s.members.map((m) => m.id)));
    setMode("default"); setIsPrivate(false); setFromPot(false); setMultiPay(false);
  };

  const cents = parseToCents(amount) ?? 0;
  const sameCurrency = currency === space.currency;
  const baseCents = sameCurrency ? cents : fx ? Math.round(cents * fx) : 0;
  const isGroup = space.kind !== "personal";
  const participants = useMemo(() => space.members.filter((m) => included.has(m.id)), [space.members, included]);

  const live = useMemo(() => {
    if (cents <= 0) return { share: 0, error: null as string | null };
    if (!sameCurrency && !fx) return { share: 0, error: "No hemos podido obtener el tipo de cambio." };
    if (!isGroup) return { share: baseCents, error: null };
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
      const s = buildSplits(baseCents, mode, participants.map((m) => ({ memberId: m.id, defaultBp: m.defaultBp })), custom);
      return { share: s.find((x) => x.memberId === space.meId)?.amountCents ?? 0, error: null };
    } catch (e) {
      return { share: 0, error: e instanceof RangeError ? e.message : x("Reparto no válido") };
    }
  }, [cents, baseCents, fx, sameCurrency, isGroup, mode, participants, pct, space.meId, x]);

  const save = async () => {
    setError(null);
    if (cents <= 0) return setError(x("Pon un importe."));
    if (!desc.trim()) return setError(x("Pon un concepto."));
    if (live.error) return setError(x(live.error));
    const payers = fromPot || !isGroup ? [] : multiPay
      ? space.members.filter((m) => parseToCents(payAmounts[m.id] ?? "")).map((m) => ({ memberId: m.id, amountCents: parseToCents(payAmounts[m.id] ?? "")! }))
      : [{ memberId: payerId }];
    const custom = mode === "custom"
      ? { kind: "percent" as const, values: Object.fromEntries(participants.map((p) => [p.id, parsePercentToBp(pct[p.id] ?? "") ?? 0])) }
      : undefined;
    const input: ExpenseInput = {
      id: prefill?.edit?.id, clientId: prefill?.edit?.clientId ?? crypto.randomUUID(), spaceId: space.id,
      description: desc.trim(), categoryId, spentAt: date, amountCents: cents, currency,
      paidFrom: fromPot ? "pot" : "member", splitMode: mode, participants: participants.map((p) => p.id), custom,
      payers, isPrivate: isGroup && isPrivate,
      tags: tags.split(/[\s,#]+/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
    };
    if (optimistic && !demo && !prefill?.edit && !photo) {
      try { localStorage.setItem(LAST_KEY, space.id); } catch { /* sin almacenamiento */ }
      optimistic(input, { shareCents: live.share, baseCents, spaceName: space.kind === "personal" ? x("Personal") : space.name, currency: space.currency });
      onClose();
      return;
    }
    setSaving(true);
    const res = demo ? await demo.submit(input) : await submitExpense(input);
    setSaving(false);
    if (!res.ok) return setError(res.error);
    if (!demo && photo && res.id !== "pending") {
      const fd = new FormData(); fd.set("expenseId", res.id); fd.set("file", photo);
      await uploadReceipt(fd);
    }
    if (!demo) { try { localStorage.setItem(LAST_KEY, space.id); } catch { /* sin almacenamiento */ } }
    onSaved({ id: res.id, shareCents: res.shareCents, spaceName: space.kind === "personal" ? x("Personal") : space.name, currency: space.currency, pending: res.id === "pending", ruleHint: res.ruleHint });
    onClose();
  };

  const accent = ACCENTS[space.kind];
  const bubbleLabel = space.kind === "personal" ? x("Personal") : space.name;
  const symbol = currencySymbol(currency, x.locale);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={x("Nuevo gasto")}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="anim-sheet flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[24px] border border-border bg-surface-2 outline-none"
      >
        {/* Zona central: es lo único que se desplaza */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-lg font-bold">{prefill?.edit ? x("Editar gasto") : x("Nuevo gasto")}</h2>
            <button type="button" onClick={onClose} aria-label={x("Cerrar")} className="grid min-h-11 min-w-11 place-items-center text-ink-2">✕</button>
          </div>

          <p className="mb-1 text-xs text-ink-3">{x("¿Dónde lo apunto?")}</p>
          <div className="mb-2 flex gap-2 overflow-x-auto [scrollbar-width:none]">
            {ctx.spaces.map((s) => {
              const on = s.id === space.id;
              return (
                <button key={s.id} type="button" disabled={!!prefill?.edit} aria-pressed={on} onClick={() => changeSpace(s)}
                  className={chip(on)} style={on ? { background: ACCENTS[s.kind], borderColor: ACCENTS[s.kind] } : undefined}>
                  {s.kind === "personal" ? x("Personal") : s.name}
                </button>
              );
            })}
          </div>

          <form className="mb-2" onSubmit={(e) => { e.preventDefault(); void runPhrase(); }}>
            <div className="flex gap-2">
              <input value={phrase} onChange={(e) => setPhrase(e.target.value)} maxLength={200} placeholder={x("Escríbelo en una frase: 23 cena con Leo a medias")} aria-label={x("Escríbelo en una frase")}
                className="min-h-11 min-w-0 flex-1 rounded-card border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-3" />
              <button type="submit" disabled={!phrase.trim() || phraseBusy} className="min-h-11 shrink-0 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-50">{phraseBusy ? x("Leyendo…") : x("Rellenar")}</button>
            </div>
            {ctx.ai && !demo && <p className="mt-1 text-xs text-ink-3">{x("La frase se envía a Google para interpretarla")}</p>}
            {phraseNote && <p role="status" className="mt-1 text-xs text-ink-2">{phraseNote}</p>}
          </form>
          <div className="mb-2 flex items-center justify-between gap-2">
            <output aria-live="polite" className="min-w-0 truncate font-mono text-4xl font-semibold tabular-nums">
              {amount === "" ? "0" : groupTyped(amount, x.locale)} <span className="text-2xl text-ink-3">{symbol}</span>
            </output>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label={x("Moneda del gasto")} className="min-h-11 shrink-0 rounded-full border border-border bg-surface px-3 text-sm text-ink-2">
              {[space.currency, ...(demo ? [] : CURRENCIES.filter((c) => c !== space.currency))].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {!sameCurrency && cents > 0 && <p className="mb-2 text-right font-mono text-sm text-ink-3">{fx ? `≈ ${formatMoney(baseCents, space.currency, x.locale)}` : x("No hemos podido obtener el tipo de cambio.")}</p>}

          <input
            value={desc} onChange={(e) => onDesc(e.target.value)} maxLength={120} placeholder={x("Concepto")} aria-label={x("Concepto")}
            className="mb-2 min-h-11 w-full rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3"
          />

          {ruleNote && <p className="mb-1 text-xs text-ink-3">{x("Regla aplicada:")} {ruleNote}</p>}
          <div ref={catRow} className="mb-2 flex gap-2 overflow-x-auto [scrollbar-width:none]" role="group" aria-label={x("Categoría")}>
            {space.categories.map((c) => {
              const on = c.id === categoryId;
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => { setCatTouched(true); setCategoryId(c.id); }} className={chip(on)}
                  style={on ? { background: accent, borderColor: accent } : undefined}>
                  {c.name}
                </button>
              );
            })}
          </div>

          <Keypad value={amount} onChange={setAmount} compact />

          {isGroup ? (
            <div className="mt-2 flex flex-col gap-2">
              {!fromPot && (
                <label className="flex items-center justify-between gap-3 text-sm text-ink-2">
                  {x("Pagó")}<select value={payerId} disabled={multiPay} onChange={(e) => setPayerId(e.target.value)}
                    className="min-h-11 rounded-card border border-border bg-surface px-3 text-ink">
                    {space.members.map((m) => <option key={m.id} value={m.id}>{m.id === space.meId ? x("Yo") : m.name}</option>)}
                  </select>
                </label>
              )}
              <div role="group" aria-label={x("Reparto")} className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
                {([["default", "Por defecto"], ["equal", "Iguales"], ["custom", "Personalizado"]] as const).map(([m, l]) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={chip(mode === m)}
                    style={mode === m ? { background: accent, borderColor: accent } : undefined}>{x(l)}</button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-3">{x("Solo lo ves tú.")}</p>
          )}

          <details className="mt-1 pb-2">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink-2">{x("Más opciones")}</summary>
            <div className="flex flex-col gap-3 pb-2">
              {!demo && (
              <div className="flex flex-col gap-2">
                <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-dashed border-border px-4 text-sm text-ink-2">
                  {photo ? `Ticket: ${photo.name.slice(0, 24)}` : x("Escanear ticket (opcional)")}
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden aria-label={x("Foto del ticket")}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      setPhoto(f);
                      setScan({ busy: true, amountCents: null, date: null });
                      try { setScan({ busy: false, ...(await scanReceipt(f)) }); } catch { setScan({ busy: false, amountCents: null, date: null, error: "No se ha podido leer el ticket." }); }
                    }} />
                </label>
                {scan && (
                  <p className="text-sm text-ink-2" aria-live="polite">
                    {scan.busy ? x("Leyendo el ticket…") : scan.error ? x(scan.error) : (scan.amountCents || scan.date ? x("Propuesta (confírmala):") : x("No he encontrado datos claros."))}
                    {!scan.busy && scan.amountCents ? <button type="button" className="ml-2 min-h-11 rounded-full border border-border px-3 font-mono" onClick={() => setAmount((scan.amountCents! / 100).toFixed(2).replace(".", ",").replace(/,00$/, ""))}>{x("Importe")}{" "}{formatMoney(scan.amountCents, space.currency, x.locale)}</button> : null}
                    {!scan.busy && scan.date ? <button type="button" className="ml-2 min-h-11 rounded-full border border-border px-3 font-mono" onClick={() => setDate(scan.date!)}>{x("Fecha")}{" "}{scan.date}</button> : null}
                  </p>
                )}
              </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-ink-3">{x("Fecha")}<input type="date" value={date} max="2100-01-01" onChange={(e) => setDate(e.target.value)}
                    className="min-h-11 rounded-card border border-border bg-surface px-3 text-sm text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">{x("Etiquetas")}<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={x("#cumple")} maxLength={80}
                    className="min-h-11 rounded-card border border-border bg-surface px-3 text-sm text-ink" />
                </label>
              </div>
              {isGroup && (
                <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
                  {space.kind === "household" && (
                    <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2">
                      <input type="checkbox" checked={fromPot} onChange={(e) => setFromPot(e.target.checked)} /> {x("Pagado desde el bote común")}</label>
                  )}
                  {!fromPot && (
                    <>
                      <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2">
                        <input type="checkbox" checked={multiPay} onChange={(e) => setMultiPay(e.target.checked)} /> {x("Pagaron varias personas")}</label>
                      {multiPay && space.members.map((m) => (
                        <label key={m.id} className="flex items-center justify-between gap-3 text-sm text-ink-2">
                          {m.name}
                          <input inputMode="decimal" value={payAmounts[m.id] ?? ""} onChange={(e) => setPayAmounts({ ...payAmounts, [m.id]: e.target.value })}
                            placeholder="0,00" className="min-h-11 w-28 rounded-card border border-border bg-surface-2 px-3 text-right font-mono text-ink" />
                        </label>
                      ))}
                    </>
                  )}
                  <div className="flex flex-wrap gap-2" role="group" aria-label={x("Quién participa")}>
                    {space.members.map((m) => {
                      const on = included.has(m.id);
                      return (
                        <button key={m.id} type="button" aria-pressed={on} className={chip(on)}
                          style={on ? { background: "var(--track)", color: "var(--text)", borderColor: "var(--track)" } : undefined}
                          onClick={() => { const n = new Set(included); if (on) n.delete(m.id); else n.add(m.id); setIncluded(n); }}>
                          {on ? "✓ " : ""}{m.id === space.meId ? x("Yo") : m.name}
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
                    {x("Gasto privado (los demás ven solo importe y reparto)")}</label>
                </div>
              )}
            </div>
          </details>
        </div>

        {/* Pie fijo: "Tu parte" y guardar siempre visibles */}
        <div className="border-t border-border bg-surface-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2">
          <p className="flex items-baseline justify-between text-sm text-ink-2" aria-live="polite">
            <span>{x("Tu parte")}</span>
            <span className="money font-mono text-lg text-ink">{formatMoney(live.share, space.currency, x.locale)}</span>
          </p>
          {(error ?? (cents > 0 ? live.error : null)) && (
            <p role="alert" className="text-sm text-over-text">{x(error ?? live.error ?? "")}</p>
          )}
          <button type="button" onClick={save} disabled={saving}
            className="mt-2 min-h-12 w-full rounded-full text-base font-semibold text-on-accent disabled:opacity-60" style={{ background: accent }}>
            {saving ? x("Guardando…") : `${x("Guardar en")} ${bubbleLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
