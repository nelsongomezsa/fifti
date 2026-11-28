"use client";

import { unstable_rethrow } from "next/navigation";
import { startTransition, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetFocus } from "@/components/ui/useSheetFocus";
import { useTx } from "@/i18n/tx-client";

/** Confirmación propia de la app para lo que borra más de lo que se ve (nada de window.confirm). */
export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose, children }: {
  title: string; description: string; confirmLabel?: string;
  onConfirm: () => Promise<{ ok: boolean; error?: string }>; onClose: () => void; children?: React.ReactNode;
}) {
  const x = useTx();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const ids = useId();
  useSheetFocus(panel, onClose);

  const confirm = () => {
    setBusy(true); setError(null);
    startTransition(async () => {
      try {
        const r = await onConfirm();
        if (r?.ok) { onClose(); return; }
        setError(r?.error ?? x("No se ha podido completar.")); setBusy(false);
      } catch (err) {
        unstable_rethrow(err); // si la acción redirige, de eso se encarga el router
        setError(x("No se ha podido completar.")); setBusy(false);
      }
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => !busy && onClose()}>
      <div ref={panel} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby={`${ids}t`} aria-describedby={`${ids}d`} onClick={(e) => e.stopPropagation()}
        className="anim-sheet m-4 mb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[80dvh] w-full max-w-sm overflow-y-auto rounded-[24px] border border-border bg-surface-2 p-5 outline-none">
        <h2 id={`${ids}t`} className="text-lg font-bold">{title}</h2>
        <p id={`${ids}d`} className="mt-1 text-sm text-ink-2">{description}</p>
        {children}
        {error && <p role="alert" className="mt-2 text-sm text-over-text">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
          <button type="button" onClick={confirm} disabled={busy} className="min-h-12 flex-1 rounded-full bg-over font-semibold text-on-accent disabled:opacity-60">{busy ? x("Borrando…") : confirmLabel ?? x("Borrar")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
