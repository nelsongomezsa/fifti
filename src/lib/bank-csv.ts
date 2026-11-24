import { CSV_MAX_BYTES, CSV_MAX_ROWS, parseAmountLoose, parseCsv, parseDateLoose, unescapeFormula } from "@/lib/csv";
import { normText } from "@/lib/rules/match";

/** Importación de extractos: detecta formatos habituales y permite mapear columnas a mano. Funciones puras. */
export type BankFormat = "fifti" | "santander" | "bbva" | "caixabank" | "ing" | "revolut" | "n26" | "generic";
export type Mapping = { headerRow: number; date: number; description: number; amount: number; positiveIsExpense?: boolean };
export type BankRow = { line: number; date: string; description: string; amountCents: number; category?: string };
export type BankParse = {
  format: BankFormat;
  rows: BankRow[];
  errors: { line: number; message: string }[];
  /** Filas que son ingresos (o gastos, según el signo) y no se importan */
  skipped: number;
  /** El formato no se reconoce: hay que elegir las columnas */
  needsMapping?: { headers: string[]; headerRow: number };
  fatal?: string;
};

const head = (h: string) => h.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const DATE_PRI = ["fecha operacion", "fecha operativa", "fecha", "booking date", "started date", "date", "completed date", "f operativa", "data", "fecha valor", "f valor", "value date"];
const DESC_PRI = ["concepto", "descripcion", "description", "partner name", "payee", "movimiento", "detalle", "payment reference", "mas datos"];
const AMT_PRI = ["importe", "importe eur", "amount", "amount eur", "cantidad"];

const find = (hs: string[], pri: string[]) => { for (const p of pri) { const i = hs.indexOf(p); if (i >= 0) return i; } return -1; };

function detectFormat(hs: string[]): BankFormat {
  const has = (h: string) => hs.includes(h);
  if (has("started date") && has("completed date")) return "revolut";
  if (has("partner name") || (has("payee") && has("transaction type"))) return "n26";
  if (has("f valor") && has("descripcion") && has("subcategoria")) return "ing";
  if (has("movimiento") && has("mas datos")) return "caixabank";
  if (has("movimiento") && has("disponible")) return "bbva";
  if (has("fecha operacion") && has("fecha valor") && has("concepto")) return "santander";
  if (has("categoria") && has("fecha") && has("concepto") && has("importe") && hs.length <= 5) return "fifti";
  return "generic";
}

/** Importe con signo: "-12,50", "12,50-", "(12,50)", "−12.50". null si no es un importe. */
export function parseSignedAmount(input: string): number | null {
  const s = input.trim().replace(/[−–]/g, "-");
  const neg = /^-/.test(s) || /-$/.test(s) || /^\(.*\)$/.test(s);
  const cents = parseAmountLoose(s.replace(/[-()+]/g, ""));
  return cents === null ? null : neg ? -cents : cents;
}

/** Fecha con o sin hora: "2026-11-10 12:30:00", "10/11/2026", "10/11/26". */
export function parseBankDate(input: string): string | null {
  const s = input.trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/);
  if (iso) return parseDateLoose(iso[1]!);
  const short = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})(?:\s.*)?$/);
  if (short) return parseDateLoose(`${short[1]}/${short[2]}/20${short[3]}`);
  const long = s.match(/^(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})(?:\s.*)?$/);
  return long ? parseDateLoose(long[1]!) : null;
}

/** Clave para detectar duplicados: fecha + importe + concepto normalizado. */
export const dupKey = (date: string, amountCents: number, description: string) => `${date}|${amountCents}|${normText(description)}`;

export function parseBankCsv(text: string, opts: { mapping?: Mapping; currency?: string } = {}): BankParse {
  const empty = (fatal: string): BankParse => ({ format: "generic", rows: [], errors: [], skipped: 0, fatal });
  if (text.length > CSV_MAX_BYTES) return empty("El archivo es demasiado grande (máx. 1 MB).");
  const all = parseCsv(text);
  if (all.length < 2) return empty("El archivo no tiene filas.");

  let headerRow = opts.mapping?.headerRow ?? -1;
  if (headerRow < 0) {
    for (let i = 0; i < Math.min(all.length, 25); i++) {
      const hs = all[i]!.map(head);
      if (find(hs, DATE_PRI) >= 0 && find(hs, AMT_PRI) >= 0) { headerRow = i; break; }
    }
  }
  if (headerRow < 0 && !opts.mapping) {
    const first = Math.max(0, all.findIndex((r) => r.length >= 3));
    return { format: "generic", rows: [], errors: [], skipped: 0, needsMapping: { headers: all[first]!.map((h) => h.trim() || "—"), headerRow: first } };
  }
  const raw = all[headerRow]!;
  const hs = raw.map(head);
  const body = all.slice(headerRow + 1);
  if (body.length > CSV_MAX_ROWS) return empty(`Demasiadas filas (máx. ${CSV_MAX_ROWS}).`);

  const m = opts.mapping;
  const di = m?.date ?? find(hs, DATE_PRI), ci = m?.description ?? find(hs, DESC_PRI), ai = m?.amount ?? find(hs, AMT_PRI);
  const gi = hs.indexOf("categoria") >= 0 ? hs.indexOf("categoria") : hs.indexOf("category");
  const cur = hs.indexOf("currency") >= 0 ? hs.indexOf("currency") : hs.indexOf("divisa");
  const st = hs.indexOf("state");
  const format = m ? "generic" : detectFormat(hs);
  if (di < 0 || ai < 0 || ci < 0) return { format, rows: [], errors: [], skipped: 0, needsMapping: { headers: raw.map((h) => h.trim() || "—"), headerRow } };

  const signed = body.map((r) => parseSignedAmount(r[ai] ?? ""));
  const anyNegative = signed.some((v) => v !== null && v < 0);
  const positiveIsExpense = m?.positiveIsExpense ?? (format === "fifti" || !anyNegative);

  const rows: BankRow[] = [], errors: BankParse["errors"] = [];
  let skipped = 0;
  body.forEach((r, i) => {
    const line = headerRow + i + 2;
    if (r.every((c) => c.trim() === "")) return;
    const date = parseBankDate(r[di] ?? "");
    const cents = signed[i]!;
    if (!date) return void errors.push({ line, message: "Fecha no válida" });
    if (cents === null || cents === 0) return void errors.push({ line, message: "Importe no válido" });
    if (st >= 0 && (r[st] ?? "").trim().toUpperCase() !== "COMPLETED") return void errors.push({ line, message: "Movimiento no completado" });
    if (cur >= 0 && opts.currency && (r[cur] ?? "").trim() && (r[cur] ?? "").trim().toUpperCase() !== opts.currency.toUpperCase()) return void errors.push({ line, message: "Moneda distinta de la burbuja" });
    if (positiveIsExpense ? cents < 0 : cents > 0) { skipped++; return; }
    const description = unescapeFormula((r[ci] ?? "").replace(/\s+/g, " ").trim()).slice(0, 120);
    if (!description) return void errors.push({ line, message: "Falta el concepto" });
    rows.push({ line, date, description, amountCents: Math.abs(cents), ...(gi >= 0 && (r[gi] ?? "").trim() ? { category: unescapeFormula(r[gi]!.trim()).slice(0, 40) } : {}) });
  });
  return { format, rows, errors, skipped };
}
