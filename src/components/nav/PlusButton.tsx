"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteExpense } from "@/server/actions/expenses";
import { loadSheetContext, type SheetContext } from "@/server/actions/sheet";
import { formatMoney } from "@/lib/money";
import { ExpenseSheet, type SavedInfo, type SheetPrefill } from "@/components/expense/ExpenseSheet";

export const CTX_CACHE_KEY = "fifti:sheetCtx";

/** Botón "+" central: toque = hoja de nuevo gasto; pulsación larga = favoritos. Gestiona el toast con "Deshacer". */
export function PlusButton({ activeSpaceId }: { activeSpaceId: string }) {
  const [ctx, setCtx] = useState<SheetContext | null>(null);
  const [sheet, setSheet] = useState<SheetPrefill | null>(null);
  const [favs, setFavs] = useState(false);
  const [toast, setToast] = useState<SavedInfo | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  const ensureCtx = useCallback(async () => {
    if (ctx) return ctx;
    let c: SheetContext | null = null;
    try {
      c = await loadSheetContext();
      try { localStorage.setItem(CTX_CACHE_KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
    } catch {
      // Sin conexión: se usan las burbujas y categorías guardadas en el dispositivo
      try { c = JSON.parse(localStorage.getItem(CTX_CACHE_KEY) ?? "null") as SheetContext | null; } catch { c = null; }
    }
    const result = c ?? { spaces: [], favorites: [] };
    setCtx(result);
    return result;
  }, [ctx]);

  // Atajo de la PWA: /inicio?nuevo=gasto abre la hoja
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("nuevo") !== "gasto") return;
    const t = setTimeout(() => { void ensureCtx().then(() => setSheet({})); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const showToast = (info: SavedInfo) => {
    setToast(info);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  };

  const undo = async () => {
    if (!toast) return;
    const id = toast.id;
    setToast(null);
    if (id !== "pending") await deleteExpense(id);
  };

  const onDown = () => {
    longFired.current = false;
    press.current = setTimeout(async () => {
      longFired.current = true;
      await ensureCtx();
      setFavs(true);
    }, 500);
  };
  const onUp = async () => {
    if (press.current) clearTimeout(press.current);
    if (longFired.current) return;
    await ensureCtx();
    setSheet({});
  };

  return (
    <>
      <button
        type="button"
        aria-label="Añadir gasto"
        aria-haspopup="dialog"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={() => { if (press.current) clearTimeout(press.current); }}
        onKeyDown={(e) => {
          const { key } = e;
          if (key === "Enter" || key === " ") { e.preventDefault(); void ensureCtx().then(() => setSheet({})); }
        }}
        onContextMenu={(e) => e.preventDefault()}
        className="-mt-5 mb-2 grid size-16 touch-manipulation select-none place-items-center rounded-full bg-accent text-on-accent shadow-[0_0_0_6px_var(--bg)]"
      >
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>

      {favs && ctx && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={() => setFavs(false)}>
          <div role="dialog" aria-label="Favoritos" onClick={(e) => e.stopPropagation()}
            className="mb-28 w-full max-w-md rounded-t-[24px] border border-border bg-surface-2 p-4">
            <h2 className="mb-3 text-lg font-bold">Favoritos</h2>
            {ctx.favorites.length === 0 ? (
              <p className="text-sm text-ink-3">Aún no tienes favoritos. Se crean desde Más.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {ctx.favorites.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="min-h-11 rounded-full border border-border px-4 text-sm"
                      onClick={() => { setFavs(false); setSheet({ spaceId: f.spaceId, amountCents: f.amountCents, categoryId: f.categoryId, description: f.label }); }}>
                      {f.label} <span className="font-mono text-ink-3">{formatMoney(f.amountCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {sheet && ctx && ctx.spaces.length > 0 && (
        <ExpenseSheet ctx={ctx} defaultSpaceId={activeSpaceId} prefill={sheet} onClose={() => setSheet(null)} onSaved={showToast} />
      )}

      {toast && (
        <div role="status" className="anim-fade fixed inset-x-4 bottom-28 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-4 py-3 shadow-lg">
          <span className="text-sm">
            {toast.pending ? "Guardado sin conexión en " : "Guardado en "}{toast.spaceName}
            {toast.shareCents > 0 && <span className="font-mono text-ink-2"> · tu parte {formatMoney(toast.shareCents, toast.currency)}</span>}
          </span>
          <button type="button" onClick={undo} className="min-h-11 px-3 text-sm font-semibold">Deshacer</button>
        </div>
      )}
    </>
  );
}
