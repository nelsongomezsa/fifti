import { z } from "zod";
import { parseToCents } from "@/lib/money";

/** Parámetros del enlace /nuevo (atajo de Siri). Solo rellenan la hoja: nunca guardan nada. */
export const quickExpenseSchema = z.object({
  importe: z.string().trim().max(14).optional(),
  concepto: z.string().trim().max(80).optional(),
  burbuja: z.string().trim().max(64).regex(/^[\p{L}\p{N} _.-]+$/u).optional(),
  categoria: z.string().trim().max(40).regex(/^[\p{L}\p{N} _.-]+$/u).optional(),
}).strict();

export type QuickExpense = { amountCents?: number; description?: string; bubble?: string; category?: string };

/** Valida los parámetros; lo que no cumpla se descarta (la hoja se abre igualmente, vacía en ese campo). */
export function parseQuickExpense(raw: Record<string, string | string[] | undefined>): QuickExpense {
  const flat: Record<string, string> = {};
  for (const k of ["importe", "concepto", "burbuja", "categoria"]) {
    const v = raw[k];
    if (typeof v === "string") flat[k] = v;
  }
  const out: QuickExpense = {};
  for (const [k, v] of Object.entries(flat)) {
    const one = quickExpenseSchema.safeParse({ [k]: v });
    if (!one.success) continue;
    if (k === "importe") { const c = parseToCents(v); if (c !== null && c > 0 && c <= 99_999_999_99) out.amountCents = c; }
    if (k === "concepto") out.description = v.trim();
    if (k === "burbuja") out.bubble = v.trim();
    if (k === "categoria") out.category = v.trim();
  }
  return out;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
export const sameText = (a: string, b: string) => norm(a) === norm(b);
