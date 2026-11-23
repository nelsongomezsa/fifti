"use client";


import { useTx } from "@/i18n/tx-client";
import { useState } from "react";
import { confirmImport, previewCsv } from "@/server/actions/csv";
import type { ImportPreview } from "@/lib/csv";
import { formatMoney } from "@/lib/money";

export function CsvImport({ spaceId }: { spaceId: string }) {
  const x = useTx();
  const [preview, setPreview] = useState<(ImportPreview & { fatal?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setResult(null);
          setPreview(await previewCsv(new FormData(e.currentTarget)));
          setBusy(false);
        }}
      >
        <input type="file" name="file" accept=".csv,text/csv" required aria-label={x("Archivo CSV")} className="min-h-11 rounded-card border border-border bg-surface p-2 text-sm" />
        <button disabled={busy} className="min-h-11 rounded-full border border-border px-5 font-semibold disabled:opacity-60">{busy ? x("Leyendo…") : x("Ver vista previa")}</button>
      </form>

      {preview?.fatal && <p role="alert" className="text-sm text-over-text">{preview.fatal}</p>}
      {preview && !preview.fatal && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 text-sm">
          <p><strong>{preview.rows.length}</strong> {x("filas válidas ·")}{" "}<span className={preview.errors.length ? "text-over-text" : ""}>{preview.errors.length} {x("con error")}</span></p>
          {preview.errors.slice(0, 5).map((er) => <p key={er.line} className="text-over-text">{x("Línea")}{" "}{er.line}: {er.message}</p>)}
          <ul className="max-h-48 overflow-auto">
            {preview.rows.slice(0, 20).map((r, i) => <li key={i} className="flex justify-between border-t border-border py-1 first:border-0"><span className="truncate">{r.date} · {r.description}</span><span className="money font-mono">{formatMoney(r.amountCents, "EUR", x.locale)}</span></li>)}
          </ul>
          {preview.rows.length > 0 && (
            <button disabled={busy} className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent disabled:opacity-60"
              onClick={async () => {
                setBusy(true);
                const r = await confirmImport({ spaceId, rows: preview.rows });
                setBusy(false);
                setResult(r.ok ? `Importados ${r.imported}${r.failed ? `, ${r.failed} no se han podido guardar` : ""}.` : (r.error ?? x("Error")));
                if (r.ok) setPreview(null);
              }}>
              {x("Confirmar e importar")}{" "}{preview.rows.length} {x("gastos")}</button>
          )}
        </div>
      )}
      {result && <p role="status" className="text-sm text-ink-2">{result}</p>}
    </div>
  );
}
