"use client";

import { useState } from "react";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";
import { confirmImport, previewCsv, type BankPreview } from "@/server/actions/csv";

const FORMAT_NAME: Record<string, string> = { santander: "Santander", bbva: "BBVA", caixabank: "CaixaBank", ing: "ING", revolut: "Revolut", n26: "N26", fifti: "Fifti", generic: "CSV" };

/** Importar un extracto: vista previa con filas elegibles, categoría editable por fila, duplicados marcados y mapeo de columnas si hace falta. */
export function CsvImport({ spaceId, currency = "EUR" }: { spaceId: string; currency?: string }) {
  const x = useTx();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [cats, setCats] = useState<Record<number, string>>({});
  const [map, setMap] = useState({ date: 0, description: 1, amount: 2, positiveIsExpense: false });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const run = async (mapping?: object) => {
    if (!file) return;
    setBusy(true); setResult(null);
    const fd = new FormData();
    fd.set("file", file); fd.set("spaceId", spaceId);
    if (mapping) fd.set("mapping", JSON.stringify(mapping));
    const p = await previewCsv(fd);
    setPreview(p);
    setPicked(Object.fromEntries(p.rows.map((r) => [r.line, r.duplicate === null])));
    setCats(Object.fromEntries(p.rows.map((r) => [r.line, r.categoryId ?? ""])));
    setBusy(false);
  };

  const chosen = preview?.rows.filter((r) => picked[r.line]) ?? [];
  const total = chosen.reduce((a, r) => a + r.amountCents, 0);

  return (
    <div className="flex flex-col gap-3">
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <input type="file" accept=".csv,text/csv" required aria-label={x("Archivo CSV")} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }}
          className="min-h-11 rounded-card border border-border bg-surface p-2 text-sm" />
        <button disabled={busy || !file} className="min-h-11 rounded-full border border-border px-5 font-semibold disabled:opacity-60">{busy ? x("Leyendo…") : x("Ver vista previa")}</button>
      </form>

      {preview?.fatal && <p role="alert" className="text-sm text-over-text">{preview.fatal}</p>}

      {preview?.needsMapping && !preview.fatal && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 text-sm">
          <p>{x("No reconocemos este formato. Elige qué columna es cada dato.")}</p>
          {([["date", "Fecha"], ["description", "Concepto"], ["amount", "Importe"]] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-ink-2">{x(label)}
              <select value={map[k]} onChange={(e) => setMap({ ...map, [k]: Number(e.target.value) })} className="min-h-11 rounded-card border border-border bg-surface-2 px-2 text-ink">
                {preview.needsMapping!.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
              </select>
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2 text-ink-2"><input type="checkbox" checked={map.positiveIsExpense} onChange={(e) => setMap({ ...map, positiveIsExpense: e.target.checked })} />{x("Los importes positivos son gastos")}</label>
          <button disabled={busy} onClick={() => void run({ headerRow: preview.needsMapping!.headerRow, date: map.date, description: map.description, amount: map.amount, positiveIsExpense: map.positiveIsExpense })}
            className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent disabled:opacity-60">{x("Aplicar columnas")}</button>
        </div>
      )}

      {preview && !preview.fatal && !preview.needsMapping && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 text-sm">
          <p className="text-ink-2">{x("Formato detectado:")} <strong className="text-ink">{FORMAT_NAME[preview.format]}</strong>
            {preview.skipped > 0 && <> · {preview.skipped} {preview.skipped === 1 ? x("movimiento que no es gasto se omite") : x("movimientos que no son gasto se omiten")}</>}</p>
          {preview.errors.length > 0 && (
            <details><summary className="min-h-11 cursor-pointer py-2 text-over-text">{preview.errors.length} {preview.errors.length === 1 ? x("fila con error") : x("filas con error")}</summary>
              {preview.errors.slice(0, 20).map((er) => <p key={er.line} className="text-over-text">{x("Línea")} {er.line}: {er.message}</p>)}</details>
          )}
          {preview.rows.length > 0 && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setPicked(Object.fromEntries(preview.rows.map((r) => [r.line, true])))} className="min-h-11 rounded-full border border-border px-4">{x("Marcar todas")}</button>
              <button type="button" onClick={() => setPicked({})} className="min-h-11 rounded-full border border-border px-4">{x("Quitar todas")}</button>
            </div>
          )}
          <ul className="flex flex-col">
            {preview.rows.map((r) => (
              <li key={r.line} className="flex flex-col gap-1 border-t border-border py-2 first:border-0">
                <label className="flex min-h-11 items-center gap-3">
                  <input type="checkbox" checked={!!picked[r.line]} onChange={(e) => setPicked({ ...picked, [r.line]: e.target.checked })} className="size-5" aria-label={`${x("Importar")} ${r.description}`} />
                  <span className="min-w-0 flex-1"><span className="block truncate">{r.description}</span>
                    <span className="text-xs text-ink-3">{r.date}{r.duplicate && <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-warn">{r.duplicate === "saved" ? x("Ya guardado") : x("Repetido en el archivo")}</span>}</span></span>
                  <span className="money shrink-0 font-mono">{formatMoney(r.amountCents, currency, x.locale)}</span>
                </label>
                <select value={cats[r.line] ?? ""} onChange={(e) => setCats({ ...cats, [r.line]: e.target.value })} aria-label={`${x("Categoría")}: ${r.description}`}
                  className="ml-8 min-h-11 rounded-card border border-border bg-surface-2 px-2 text-sm">
                  <option value="">{x("Sin categoría")}</option>
                  {preview.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
          {preview.rows.length > 0 && (
            <button disabled={busy || chosen.length === 0} className="min-h-12 rounded-full bg-accent px-5 font-semibold text-on-accent disabled:opacity-60"
              onClick={async () => {
                setBusy(true);
                const r = await confirmImport({ spaceId, rows: chosen.map((c) => ({ date: c.date, description: c.description, amountCents: c.amountCents, categoryId: cats[c.line] || null })) });
                setBusy(false);
                setResult(r.ok ? `${x("Importados")} ${r.imported}${r.failed ? `, ${r.failed} ${x("no se han podido guardar")}` : ""}.` : (r.error ?? x("Error")));
                if (r.ok) { setPreview(null); setFile(null); }
              }}>
              {x("Importar")} {chosen.length} {chosen.length === 1 ? x("gasto") : x("gastos")} · {formatMoney(total, currency, x.locale)}</button>
          )}
        </div>
      )}
      {result && <p role="status" className="text-sm text-ink-2">{result}</p>}
    </div>
  );
}
