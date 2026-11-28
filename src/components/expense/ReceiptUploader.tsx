"use client";


import { useTx } from "@/i18n/tx-client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { removeReceipt, uploadReceipt } from "@/lib/upload-receipt";

/** Poner, cambiar o quitar la foto del ticket: se valida y limpia en el servidor (tipo real, tamaño, sin EXIF). */
export function ReceiptUploader({ expenseId, hasReceipt }: { expenseId: string; hasReceipt: boolean }) {
  const x = useTx();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const remove = async () => {
    setBusy(true); setError(null);
    const r = await removeReceipt(expenseId, x);
    setBusy(false); setConfirming(false);
    if (!r.ok) setError(r.error); else router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden aria-label={x("Foto del ticket")}
        onChange={async (e) => {
          const target = e.target;
          const file = target.files?.[0];
          if (!file) return;
          setBusy(true); setError(null);
          const r = await uploadReceipt(expenseId, file, x);
          setBusy(false);
          if (!r.ok) setError(r.error); else router.refresh();
          target.value = "";
        }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="min-h-11 rounded-full border border-border px-5 font-semibold disabled:opacity-60">
        {busy && !confirming ? x("Subiendo…") : hasReceipt ? x("Cambiar foto del ticket") : x("Añadir foto del ticket")}
      </button>
      {hasReceipt && !confirming && (
        <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="min-h-11 rounded-full px-5 font-semibold text-over-text disabled:opacity-60">{x("Quitar foto")}</button>
      )}
      {hasReceipt && confirming && (
        <div role="alertdialog" aria-label={x("¿Quitar la foto?")} className="flex flex-col gap-2 rounded-card border border-over p-3">
          <p className="text-sm text-ink-2">{x("¿Quitar la foto?")} {x("Se borra del todo; el gasto se queda.")}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
            <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 flex-1 rounded-full bg-over font-semibold text-on-accent disabled:opacity-60">{x("Quitar")}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-over-text">{error}</p>}
    </div>
  );
}
