"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { useTx } from "@/i18n/tx-client";
import { deleteExpenseAndGo } from "@/server/actions/expenses";

/** Borrar con confirmación propia de la app (nada de window.confirm). */
export function DeleteExpenseButton({ expenseId }: { expenseId: string }) {
  const x = useTx();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancel.current?.focus();
    const onKeyDown = (ev: KeyboardEvent) => { const { key } = ev; if (key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const confirm = () => {
    setBusy(true); setError(null);
    startTransition(async () => {
      try {
        // Si sale bien, el servidor redirige y este diálogo desaparece con la pantalla; solo vuelve con respuesta si falla
        const r = await deleteExpenseAndGo(expenseId);
        setError(r.error); setBusy(false);
      } catch (err) {
        unstable_rethrow(err); // la redirección la gestiona el router
        setError(x("No se ha podido completar.")); setBusy(false);
      }
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-full border border-border px-5 font-semibold text-over-text">{x("Borrar")}</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => !busy && setOpen(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-desc" onClick={(e) => e.stopPropagation()}
            className="anim-sheet m-4 w-full max-w-sm rounded-[24px] border border-border bg-surface-2 p-5">
            <h2 id="del-title" className="text-lg font-bold">{x("¿Borrar este gasto?")}</h2>
            <p id="del-desc" className="mt-1 text-sm text-ink-2">{x("Se quitará de la lista y de tus cuentas. Esta acción no se puede deshacer.")}</p>
            {error && <p role="alert" className="mt-2 text-sm text-over-text">{error}</p>}
            <div className="mt-4 flex gap-3">
              <button ref={cancel} type="button" onClick={() => setOpen(false)} disabled={busy} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
              <button type="button" onClick={confirm} disabled={busy} className="min-h-12 flex-1 rounded-full bg-over font-semibold text-on-accent disabled:opacity-60">{busy ? x("Borrando…") : x("Borrar")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
