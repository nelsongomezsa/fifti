"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadReceipt } from "@/server/actions/receipts";

/** Subida de la foto del ticket: se valida y limpia en el servidor (tipo real, 5 MB, sin EXIF). */
export function ReceiptUploader({ expenseId, hasReceipt }: { expenseId: string; hasReceipt: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden aria-label="Foto del ticket"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) return setError("La foto debe pesar menos de 5 MB.");
          setBusy(true); setError(null);
          const fd = new FormData(); fd.set("expenseId", expenseId); fd.set("file", file);
          const r = await uploadReceipt(fd);
          setBusy(false);
          if (!r.ok) setError(r.error); else router.refresh();
          e.target.value = "";
        }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="min-h-11 rounded-full border border-border px-5 font-semibold disabled:opacity-60">
        {busy ? "Subiendo…" : hasReceipt ? "Cambiar foto del ticket" : "Añadir foto del ticket"}
      </button>
      {error && <p role="alert" className="text-sm text-over-text">{error}</p>}
    </div>
  );
}
