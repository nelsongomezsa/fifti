"use client";

import { startTransition, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { useSheetFocus } from "@/components/ui/useSheetFocus";
import { useTx } from "@/i18n/tx-client";
import { removeBankAccount } from "@/server/actions/accounts";

/** Confirmación de borrado de una cuenta, con lo que se pierde y lo que no. */
export function DeleteAccountDialog({ id, name, demo, onClose }: { id: string; name: string; demo: boolean; onClose: () => void }) {
  const x = useTx();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useSheetFocus(panel, onClose);

  const confirm = () => {
    if (demo) { setError(x("Crea una cuenta para guardar")); return; }
    setBusy(true); setError(null);
    startTransition(async () => {
      try {
        // Si sale bien, el servidor redirige a Mis cuentas; solo vuelve con respuesta si falla
        const r = await removeBankAccount({ id });
        setError(r.error ?? x("No se ha podido completar.")); setBusy(false);
      } catch (err) {
        unstable_rethrow(err);
        setError(x("No se ha podido completar.")); setBusy(false);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => !busy && onClose()}>
      <div ref={panel} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="del-account-title" aria-describedby="del-account-desc" onClick={(e) => e.stopPropagation()}
        className="anim-sheet m-4 w-full max-w-sm rounded-[24px] border border-border bg-surface-2 p-5 outline-none">
        <h2 id="del-account-title" className="text-lg font-bold">{`${x("¿Borrar la cuenta")} «${name}»?`}</h2>
        <p id="del-account-desc" className="mt-1 text-sm text-ink-2">{x("Se borran la cuenta, sus traspasos y sus ajustes. Los gastos no se borran: dejan de estar asignados a esta cuenta.")}</p>
        {error && <p role="alert" className="mt-2 text-sm text-over-text">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
          <button type="button" onClick={confirm} disabled={busy} className="min-h-12 flex-1 rounded-full bg-over font-semibold text-on-accent disabled:opacity-60">{busy ? x("Borrando…") : x("Borrar")}</button>
        </div>
      </div>
    </div>
  );
}

/** Botón del detalle de la cuenta. */
export function DeleteAccountButton({ id, name, demo }: { id: string; name: string; demo: boolean }) {
  const x = useTx();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="min-h-12 w-full rounded-full border border-over font-semibold text-over-text">{x("Borrar cuenta")}</button>
      {open && <DeleteAccountDialog id={id} name={name} demo={demo} onClose={() => setOpen(false)} />}
    </>
  );
}
