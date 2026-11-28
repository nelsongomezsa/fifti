"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { useSheetFocus } from "@/components/ui/useSheetFocus";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";
import { previewAccountDeletion, removeBankAccount } from "@/server/actions/accounts";

type Impact = Awaited<ReturnType<typeof previewAccountDeletion>>;

/** Confirmación de borrado de una cuenta, con lo que se pierde, lo que no y los saldos que cambian. */
export function DeleteAccountDialog({ id, name, shared = false, demo, onClose }: { id: string; name: string; shared?: boolean; demo: boolean; onClose: () => void }) {
  const x = useTx();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(demo ? { ok: false } : null);
  const panel = useRef<HTMLDivElement>(null);
  useSheetFocus(panel, onClose);

  useEffect(() => {
    if (demo) return;
    let live = true;
    previewAccountDeletion({ id }).then((r) => { if (live) setImpact(r); }).catch(() => { if (live) setImpact({ ok: false }); });
    return () => { live = false; };
  }, [id, demo]);

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

  const signed = (cents: number, currency: string) => `${cents > 0 ? "+" : "−"}${formatMoney(Math.abs(cents), currency, x.locale)}`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => !busy && onClose()}>
      <div ref={panel} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="del-account-title" aria-describedby="del-account-desc" onClick={(e) => e.stopPropagation()}
        className="anim-sheet m-4 max-h-[80dvh] w-full max-w-sm overflow-y-auto rounded-[24px] border border-border bg-surface-2 p-5 outline-none">
        <h2 id="del-account-title" className="text-lg font-bold">{`${x("¿Borrar la cuenta")} «${name}»?`}</h2>
        <p id="del-account-desc" className="mt-1 text-sm text-ink-2">{x("Se borran la cuenta, sus traspasos y sus ajustes. Los gastos no se borran: dejan de estar asignados a esta cuenta.")}</p>
        {impact === null && <p role="status" className="mt-2 text-sm text-ink-3">{x("Calculando los saldos…")}</p>}
        {impact?.ok === false && !demo && <p className="mt-2 text-sm text-warn">{x("El saldo de otras cuentas con traspasos puede cambiar.")}</p>}
        {impact?.ok && (
          <div className="mt-2 flex flex-col gap-1 text-sm text-warn">
            {impact.changes.length > 0 && (
              <>
                <p>{x("El saldo de estas cuentas cambiará:")}</p>
                <ul>{impact.changes.map((c) => <li key={c.name} className="flex justify-between gap-3"><span className="truncate">{c.name}</span><span className="money font-mono">{signed(c.deltaCents, c.currency)}</span></li>)}</ul>
              </>
            )}
            {impact.hidden && <p>{x("También cambiará el saldo de cuentas de otros miembros.")}</p>}
            {shared && impact.othersTransfers && <p>{x("Es una cuenta común: se borran también traspasos que apuntaron otros miembros.")}</p>}
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-over-text">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
          {/* Hasta saber qué cambia no se puede confirmar: el aviso se ve antes de borrar */}
          <button type="button" onClick={confirm} disabled={busy || impact === null} className="min-h-12 flex-1 rounded-full bg-over font-semibold text-on-accent disabled:opacity-60">{busy ? x("Borrando…") : x("Borrar")}</button>
        </div>
      </div>
    </div>
  );
}

/** Botón del detalle de la cuenta. */
export function DeleteAccountButton({ id, name, shared, demo }: { id: string; name: string; shared: boolean; demo: boolean }) {
  const x = useTx();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="min-h-12 w-full rounded-full border border-over font-semibold text-over-text">{x("Borrar cuenta")}</button>
      {open && <DeleteAccountDialog id={id} name={name} shared={shared} demo={demo} onClose={() => setOpen(false)} />}
    </>
  );
}
