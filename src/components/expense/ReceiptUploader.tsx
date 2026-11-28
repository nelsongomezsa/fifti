"use client";


import { useTx } from "@/i18n/tx-client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadReceipt } from "@/lib/upload-receipt";

/** Subida de la foto del ticket: se valida y limpia en el servidor (tipo real, tamaño, sin EXIF). */
export function ReceiptUploader({ expenseId, hasReceipt }: { expenseId: string; hasReceipt: boolean }) {
  const x = useTx();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
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
        {busy ? x("Subiendo…") : hasReceipt ? x("Cambiar foto del ticket") : x("Añadir foto del ticket")}
      </button>
      {error && <p role="alert" className="text-sm text-over-text">{error}</p>}
    </div>
  );
}
