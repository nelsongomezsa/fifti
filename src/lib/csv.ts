import { z } from "zod";
import { MAX_AMOUNT_CENTS } from "@/lib/money";

export const CSV_MAX_BYTES = 1_000_000;
export const CSV_MAX_ROWS = 500;

const FORMULA_START = /^[=+\-@\t\r]/;

/** Evita la inyección de fórmulas en Excel/Sheets: si empieza por = + - @ tab o CR se antepone una comilla simple. */
export function escapeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}
/** Operación inversa al importar un archivo exportado por Fifti. */
export function unescapeFormula(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

function cell(v: string | number): string {
  const s = escapeFormula(String(v));
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Parser CSV con comillas, comillas escapadas y saltos de línea dentro de campos. Separador coma o punto y coma. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (inQ) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** "1.234,56", "1,234.56", "12,5", "12.50" → céntimos. null si no es un importe válido. */
export function parseAmountLoose(input: string): number | null {
  let s = input.replace(/[€$£\s]/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  const dec = Math.max(lastDot, lastComma);
  if (dec >= 0 && s.length - dec - 1 <= 2) {
    s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  } else {
    s = s.replace(/[.,]/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export function parseDateLoose(input: string): string | null {
  const s = input.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s;
  else {
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  if (!iso || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toISOString().slice(0, 10) === iso ? iso : null;
}

export const importRowSchema = z
  .object({ date: z.string(), description: z.string().trim().min(1).max(120), amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS), category: z.string().trim().max(40).optional() })
  .strict();
export type ImportRow = z.infer<typeof importRowSchema>;
export type ImportPreview = { rows: ImportRow[]; errors: { line: number; message: string }[] };

const HEAD = {
  date: ["fecha", "date"], description: ["concepto", "descripcion", "descripción", "description"],
  amount: ["importe", "amount", "cantidad"], category: ["categoria", "categoría", "category"],
} as const;

/** Valida un CSV completo: tamaño, nº de filas, cabecera y cada fila con Zod. Nada se guarda: es la vista previa. */
export function previewImport(text: string): ImportPreview {
  if (text.length > CSV_MAX_BYTES) return { rows: [], errors: [{ line: 0, message: "El archivo es demasiado grande (máx. 1 MB)." }] };
  const all = parseCsv(text);
  if (all.length < 2) return { rows: [], errors: [{ line: 0, message: "El archivo no tiene filas." }] };
  if (all.length - 1 > CSV_MAX_ROWS) return { rows: [], errors: [{ line: 0, message: `Demasiadas filas (máx. ${CSV_MAX_ROWS}).` }] };
  const header = all[0]!.map((h) => h.trim().toLowerCase());
  const idx = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const di = idx(HEAD.date), ci = idx(HEAD.description), ai = idx(HEAD.amount), gi = idx(HEAD.category);
  if (di < 0 || ci < 0 || ai < 0) return { rows: [], errors: [{ line: 1, message: "Faltan columnas: fecha, concepto e importe." }] };
  const rows: ImportRow[] = [], errors: ImportPreview["errors"] = [];
  all.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = parseDateLoose(r[di] ?? "");
    const amountCents = parseAmountLoose(r[ai] ?? "");
    if (!date) return errors.push({ line, message: "Fecha no válida" });
    if (!amountCents) return errors.push({ line, message: "Importe no válido" });
    const parsed = importRowSchema.safeParse({
      date, description: unescapeFormula((r[ci] ?? "").trim()), amountCents, category: gi >= 0 ? unescapeFormula((r[gi] ?? "").trim()) || undefined : undefined,
    });
    if (!parsed.success) return errors.push({ line, message: parsed.error.issues[0]?.message ?? "Fila no válida" });
    rows.push(parsed.data);
  });
  return { rows, errors };
}
