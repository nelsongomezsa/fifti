"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, HandCoins, Home, PiggyBank, Receipt, Repeat, Settings, Wallet } from "lucide-react";
import { SheetShell } from "@/components/ui/SheetShell";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { ExpenseSheet, type SheetPrefill } from "@/components/expense/ExpenseSheet";
import { usePendingExpenses } from "@/components/expense/optimistic";
import { SHEET_CONTEXT_STALE } from "@/lib/sheet-context";
import { useTx } from "@/i18n/tx-client";
import { removeItem } from "@/lib/offline/queue";
import { submitExpense } from "@/lib/offline/submit";
import { formatMoney } from "@/lib/money";
import { parseQuickExpense, sameText, type QuickExpense } from "@/lib/validation/quick-expense";
import type { ExpenseInput } from "@/lib/validation/expense";
import { deleteExpense } from "@/server/actions/expenses";
import { loadSheetContext, type SheetContext } from "@/server/actions/sheet";

// La forma del contexto cambió (moneda de cada cuenta); un contexto guardado antiguo ya no se usa
export const CTX_CACHE_KEY = "fifti:sheetCtx:v4";

type Toast =
  | { type: "saved"; cid: string; id: string | null; spaceName: string; shareCents: number; currency: string; queued: boolean }
  | { type: "error"; message: string; retry: SheetPrefill }
  | { type: "undone" };

/** Contexto guardado en el dispositivo, comprobado: si le falta algo, se descarta en vez de romper la hoja. */
/** El aviso que devuelve la demo al intentar guardar (ya traducido por el servidor según el idioma). */
const isDemoMessage = (m: string) => m === "Crea una cuenta para guardar" || m === "Create an account to save";

const readCached = (): SheetContext | null => {
  try {
    localStorage.removeItem("fifti:sheetCtx");
    const c = JSON.parse(localStorage.getItem(CTX_CACHE_KEY) ?? "null") as SheetContext | null;
    if (!c || !Array.isArray(c.spaces) || !Array.isArray(c.favorites)) return null;
    const ok = c.spaces.every((s) => Array.isArray(s.members) && Array.isArray(s.categories) && Array.isArray(s.rules));
    return ok ? c : null;
  } catch { return null; }
};

/** Convierte los parámetros del enlace en el relleno de la hoja (burbuja y categoría por id o por nombre). */
function quickPrefill(q: QuickExpense, ctx: SheetContext): SheetPrefill {
  const sp = q.bubble
    ? ctx.spaces.find((s) => s.id === q.bubble) ?? (sameText(q.bubble, "personal") ? ctx.spaces.find((s) => s.kind === "personal") : undefined) ?? ctx.spaces.find((s) => sameText(s.name, q.bubble!))
    : undefined;
  const cat = q.category && sp ? sp.categories.find((c) => c.id === q.category || sameText(c.name, q.category!)) : undefined;
  return { ...(sp ? { spaceId: sp.id } : {}), ...(q.amountCents ? { amountCents: q.amountCents } : {}), ...(q.description ? { description: q.description } : {}), ...(cat ? { categoryId: cat.id } : {}) };
}

/**
 * Botón "+" central. Es un enlace real (?nuevo=gasto): si se toca antes de que la página termine de cargar, igualmente abre la hoja.
 * Con la página lista abre al instante (usa el contexto guardado y lo refresca en segundo plano) y guarda de forma optimista.
 */
export function PlusButton({ activeSpaceId }: { activeSpaceId: string }) {
  const x = useTx();
  const router = useRouter();
  const pending = usePendingExpenses();
  const [ctx, setCtx] = useState<SheetContext | null>(null);
  const [sheet, setSheet] = useState<SheetPrefill | null>(null);
  const [quick, setQuick] = useState<QuickExpense | null>(null);
  const [favs, setFavs] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [phraseText, setPhraseText] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const savedRef = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const cancelled = useRef(new Set<string>());
  /** Guardados en curso: «Deshacer» antes de que terminen espera al id real y lo borra */
  const inflight = useRef(new Map<string, Promise<{ ok: boolean; id?: string }>>());

  const refreshCtx = useCallback(async () => {
    try {
      const c = await loadSheetContext();
      setCtx(c);
      try { localStorage.setItem(CTX_CACHE_KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
    } catch {
      setCtx((cur) => cur ?? readCached()); // sin conexión: lo guardado en el dispositivo
    }
  }, []);

  // Precarga: contexto guardado al instante y datos frescos cuando el navegador está libre
  useEffect(() => {
    const t0 = setTimeout(() => {
      const cached = readCached();
      if (cached) setCtx(cached);
      const q = new URLSearchParams(window.location.search);
      if (q.get("nuevo") === "gasto") {
        setSheet({});
        const qe = parseQuickExpense({ importe: q.get("importe") ?? undefined, concepto: q.get("concepto") ?? undefined, burbuja: q.get("burbuja") ?? undefined, categoria: q.get("categoria") ?? undefined });
        if (Object.keys(qe).length) setQuick(qe);
        for (const k of ["nuevo", "importe", "concepto", "burbuja", "categoria"]) q.delete(k);
        const rest = q.toString();
        window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
      }
    }, 0);
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const t1 = idle ? idle(() => void refreshCtx()) : window.setTimeout(() => void refreshCtx(), 300);
    return () => { clearTimeout(t0); if (!idle) clearTimeout(t1 as number); };
  }, [refreshCtx]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const onStale = () => {
      try { localStorage.removeItem(CTX_CACHE_KEY); } catch { /* sin almacenamiento */ }
      void refreshCtx();
    };
    window.addEventListener(SHEET_CONTEXT_STALE, onStale);
    return () => window.removeEventListener(SHEET_CONTEXT_STALE, onStale);
  }, [refreshCtx]);
  useEffect(() => {
    if (refreshing || savedRef.current.length === 0) return;
    const done = savedRef.current;
    savedRef.current = [];
    const t = setTimeout(() => pending.remove(done), 0);
    return () => clearTimeout(t);
  }, [refreshing, pending]);

  const showToast = (t: Toast) => {
    setToast(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  };

  const openSheet = (prefill: SheetPrefill = {}) => {
    setFavs(false);
    setSheet(prefill);
    if (!ctx) void refreshCtx();
  };

  /** Guardado optimista: el gasto aparece ya en la lista y en Inicio; si el servidor falla se revierte. */
  const submitOptimistic = async (input: ExpenseInput, info: { shareCents: number; baseCents: number; spaceName: string; currency: string }) => {
    const cid = input.clientId;
    pending.add({ cid, spaceId: input.spaceId, description: input.description, amountCents: input.amountCents, baseCents: info.baseCents, shareCents: info.shareCents, currency: input.currency, spentAt: input.spentAt, status: "saving" });
    showToast({ type: "saved", cid, id: null, spaceName: info.spaceName, shareCents: info.shareCents, currency: info.currency, queued: false });
    const job = submitExpense(input).catch(() => ({ ok: false as const, error: "No se ha podido guardar el gasto." }));
    inflight.current.set(cid, job as Promise<{ ok: boolean; id?: string }>);
    const res = await job;
    inflight.current.delete(cid);
    if (cancelled.current.has(cid)) { cancelled.current.delete(cid); return; } // «Deshacer» ya se ocupó de él
    if (!res.ok) {
      pending.remove([cid]);
      showToast({ type: "error", message: res.error, retry: { spaceId: input.spaceId, amountCents: input.amountCents, currency: input.currency, categoryId: input.categoryId ?? null, description: input.description } });
      return;
    }
    const queued = res.id === "pending";
    pending.patch(cid, { status: queued ? "queued" : "saved" });
    setToast((t) => (t && t.type === "saved" && t.cid === cid ? { ...t, id: queued ? null : res.id, queued } : t));
    if (!queued) {
      savedRef.current.push(cid); // se retira cuando la lista real (con este gasto) ya está pintada
      startRefresh(() => router.refresh());
    }
  };

  const undo = async () => {
    if (!toast || toast.type !== "saved") return;
    const t = toast;
    setToast(null);
    pending.remove([t.cid]);
    let id = t.id;
    const job = inflight.current.get(t.cid);
    if (!id && job) {
      cancelled.current.add(t.cid); // el guardado en curso no debe pintar nada al terminar
      const res = await job; // se espera al id real del servidor
      id = res.ok ? res.id ?? null : null;
    }
    if (id && id !== "pending") await deleteExpense(id);
    else if (id === "pending") await removeItem(t.cid).catch(() => undefined); // estaba en la cola sin conexión: se saca de ella
    showToast({ type: "undone" });
    startRefresh(() => router.refresh());
  };

  const onDown = () => {
    longFired.current = false;
    press.current = setTimeout(() => { longFired.current = true; setFavs(true); if (!ctx) void refreshCtx(); }, 500);
  };

  return (
    <>
      <a
        href="?nuevo=gasto"
        role="button"
        aria-label={x("Añadir gasto")}
        aria-haspopup="dialog"
        onPointerDown={onDown}
        onPointerUp={() => { if (press.current) clearTimeout(press.current); }}
        onPointerLeave={() => { if (press.current) clearTimeout(press.current); }}
        onClick={(e) => {
          e.preventDefault();
          if (longFired.current) { longFired.current = false; return; }
          setChooser(true);
        }}
        onKeyDown={(e) => { const { key } = e; if (key === " ") { e.preventDefault(); setChooser(true); } }}
        onContextMenu={(e) => e.preventDefault()}
        className="-mt-6 mb-2 grid size-[60px] touch-manipulation select-none place-items-center rounded-full bg-accent text-on-accent shadow-[0_0_0_6px_var(--bg)]"
      >
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </a>

      {chooser && (
        <SheetShell onClose={() => setChooser(false)} label={x("¿Qué quieres apuntar?")}>
          <h2 className="mb-3 text-xl font-bold">{x("¿Qué quieres apuntar?")}</h2>
          <button type="button" onClick={() => { setChooser(false); openSheet(); }} className="flex min-h-16 w-full items-center gap-3 rounded-card bg-accent px-4 text-left text-on-accent">
            <Receipt size={26} aria-hidden /><span><span className="block text-lg font-bold">{x("Gasto")}</span><span className="block text-sm opacity-80">{x("Lo que acabas de pagar")}</span></span>
          </button>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {([["/fijos/nuevo", Repeat, "Gasto fijo", "Alquiler, Spotify…"], ["/ingreso", Wallet, "Ingreso", "Nómina, un extra…"], ["/plan?vista=ahorro", PiggyBank, "Aportar a una meta", "A tu viaje o colchón"], ["/prestamos#nuevo-prestamo", HandCoins, "Préstamo", "Dejaste o te dejaron"], ["/traspaso", ArrowRightLeft, "Traspaso", "Entre tus cuentas"], ["/aportar", Home, "Aportar al hogar", "Tu parte del gasto común"]] as const).map(([href, Icon, title, hint]) => (
              <Link key={href} href={href} prefetch={false} onClick={() => setChooser(false)} className="flex min-h-28 flex-col justify-between rounded-card border border-border bg-surface p-3">
                <Icon size={22} aria-hidden className="text-ink-2" />
                <span><span className="block font-semibold">{x(title)}</span><span className="block text-xs text-ink-3">{x(hint)}</span></span>
              </Link>
            ))}
          </div>
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = phraseText.trim(); if (!t) return; setChooser(false); setPhraseText(""); openSheet({ phrase: t }); }}>
            <input value={phraseText} onChange={(e) => setPhraseText(e.target.value)} maxLength={200} aria-label={x("Frase rápida")} placeholder={x("O escríbelo: «12 cena con Leo»")}
              className="min-h-12 min-w-0 flex-1 rounded-card border border-border bg-surface px-4 text-sm text-ink placeholder:text-ink-3" />
            <button type="submit" disabled={!phraseText.trim()} className="min-h-12 shrink-0 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-50">{x("Rellenar")}</button>
          </form>
          {/* Ajustes también aquí abajo: el engranaje de la cabecera queda lejos del pulgar */}
          <Link href="/ajustes" prefetch={false} onClick={() => setChooser(false)} className="mt-3 flex min-h-12 items-center gap-3 rounded-card border border-border bg-surface px-4 text-sm font-semibold">
            <Settings size={20} aria-hidden className="text-ink-2" />{x("Ajustes")}
          </Link>
        </SheetShell>
      )}

      {favs && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={() => setFavs(false)}>
          <div role="dialog" aria-label={x("Favoritos")} onClick={(e) => e.stopPropagation()} className="mb-28 w-full max-w-md rounded-t-[24px] border border-border bg-surface-2 p-4">
            <h2 className="mb-3 text-lg font-bold">{x("Favoritos")}</h2>
            {!ctx ? <div className="h-11 w-2/3 animate-pulse rounded-full bg-track" /> : ctx.favorites.length === 0 ? (
              <p className="text-sm text-ink-3">{x("Aún no tienes favoritos. Se crean desde Más.")}</p>
            ) : (
              <ul className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto">
                {ctx.favorites.map((f) => (
                  <li key={f.id}>
                    <SwipeRow id={f.id} name={f.label} kind="favorite">
                      <button type="button" className="min-h-11 w-full rounded-card border border-border bg-surface px-4 text-left text-sm"
                        onClick={() => openSheet({ spaceId: f.spaceId, amountCents: f.amountCents, categoryId: f.categoryId, description: f.label })}>
                        {f.label} <span className="money font-mono text-ink-3">{formatMoney(f.amountCents, ctx.spaces.find((s) => s.id === f.spaceId)?.currency ?? "EUR", x.locale)}</span>
                      </button>
                    </SwipeRow>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {sheet && !ctx && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={() => setSheet(null)}>
          <div role="dialog" aria-modal="true" aria-busy="true" aria-label={x("Nuevo gasto")} onClick={(e) => e.stopPropagation()}
            className="anim-sheet flex h-[70dvh] w-full max-w-md flex-col gap-3 rounded-t-[24px] border border-border bg-surface-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{x("Nuevo gasto")}</h2>
              <button type="button" onClick={() => setSheet(null)} aria-label={x("Cerrar")} className="grid min-h-11 min-w-11 place-items-center text-ink-2">✕</button>
            </div>
            <div className="h-11 w-2/3 animate-pulse rounded-full bg-track" /><div className="h-12 w-1/2 animate-pulse rounded-card bg-track" />
            <div className="h-11 w-full animate-pulse rounded-card bg-track" /><div className="mt-auto h-12 w-full animate-pulse rounded-full bg-track" />
          </div>
        </div>
      )}
      {sheet && ctx && ctx.spaces.length > 0 && (
        <ExpenseSheet ctx={ctx} defaultSpaceId={activeSpaceId} prefill={quick ? quickPrefill(quick, ctx) : sheet} onClose={() => { setSheet(null); setQuick(null); }} onSaved={() => undefined} optimistic={(i, info) => void submitOptimistic(i, info)} />
      )}

      {toast && (
        <div role="status" className="anim-fade fixed inset-x-4 bottom-[calc(7rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-4 py-3 shadow-lg">
          {toast.type === "saved" ? (
            <>
              <span className="text-sm">
                {toast.queued ? x("Guardado sin conexión en ") : x("Guardado en ")}{toast.spaceName}
                {toast.shareCents > 0 && <span className="font-mono text-ink-2"> · {x("tu parte")} {formatMoney(toast.shareCents, toast.currency, x.locale)}</span>}
              </span>
              <button type="button" onClick={undo} className="min-h-11 px-3 text-sm font-semibold">{x("Deshacer")}</button>
            </>
          ) : toast.type === "undone" ? (
            <span className="text-sm">{x("Gasto deshecho")}</span>
          ) : (
            <>
              <span className="text-sm text-over-text">{x(toast.message)}</span>
              {isDemoMessage(toast.message)
                ? <Link href="/registro" prefetch={false} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-lime px-4 text-sm font-semibold text-on-accent">{x("Crear cuenta")}</Link>
                : <button type="button" onClick={() => { const r = toast.retry; setToast(null); openSheet(r); }} className="min-h-11 px-3 text-sm font-semibold">{x("Reintentar")}</button>}
            </>
          )}
        </div>
      )}
    </>
  );
}
