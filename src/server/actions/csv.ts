"use server";

import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createHash } from "node:crypto";
import { dupKey, parseBankCsv, type BankFormat } from "@/lib/bank-csv";
import { CSV_MAX_BYTES, CSV_MAX_ROWS } from "@/lib/csv";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { matchRule, normText, type RuleType } from "@/lib/rules/match";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { saveExpense } from "./expenses";

export type PreviewRow = { line: number; date: string; description: string; amountCents: number; categoryId: string | null; duplicate: "saved" | "file" | null };
export type BankPreview = {
  fatal?: string; format: BankFormat; rows: PreviewRow[]; errors: { line: number; message: string }[]; skipped: number;
  needsMapping?: { headers: string[]; headerRow: number }; categories: { id: string; name: string }[];
};

const mappingSchema = z.object({
  headerRow: z.number().int().min(0).max(50), date: z.number().int().min(0).max(60), description: z.number().int().min(0).max(60),
  amount: z.number().int().min(0).max(60), positiveIsExpense: z.boolean().optional(),
}).strict();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** UUID determinista por fila: reenviar el mismo lote no crea gastos repetidos (el guardado es idempotente por client_id). */
const rowClientId = (spaceId: string, key: string, n: number) => {
  const h = sha(`${spaceId}|${key}|${n}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** Paso 1: lee y valida el extracto, aplica las reglas y marca duplicados. No guarda nada. */
export async function previewCsv(fd: FormData): Promise<BankPreview> {
  const x = await getTx();
  const fail = (m: string): BankPreview => ({ fatal: x(m), format: "generic", rows: [], errors: [], skipped: 0, categories: [] });
  const file = fd.get("file");
  const spaceId = z.uuid().safeParse(fd.get("spaceId"));
  if (!(file instanceof File) || !spaceId.success) return fail("Elige un archivo CSV.");
  if (file.size > CSV_MAX_BYTES) return fail("El archivo es demasiado grande (máx. 1 MB).");
  let mapping: z.infer<typeof mappingSchema> | undefined;
  const rawMap = fd.get("mapping");
  if (typeof rawMap === "string" && rawMap) {
    try { mapping = mappingSchema.parse(JSON.parse(rawMap)); } catch { return fail("Columnas no válidas."); }
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail("Sesión caducada.");
  if (!(await allow(RULES.importCsv, data.user.id))) return fail("Demasiados intentos. Espera un rato.");

  const [{ data: space }, { data: cats }, { data: rules }] = await Promise.all([
    supabase.from("spaces").select("base_currency").eq("id", spaceId.data).maybeSingle(),
    supabase.from("categories").select("id, name, system_key").eq("space_id", spaceId.data),
    supabase.from("category_rules").select("id, match_text, match_type, category_id, priority").eq("space_id", spaceId.data),
  ]);
  if (!space) return fail("No autorizado.");
  const parsed = parseBankCsv(await file.text(), { mapping, currency: space.base_currency });
  const categories = (cats ?? []).map((c) => ({ id: c.id, name: displayName(x, c.name, c.system_key) }));
  if (parsed.fatal) return { ...fail(parsed.fatal), fatal: x(parsed.fatal) };
  const ruleList = (rules ?? []).map((r) => ({ id: r.id, matchText: r.match_text, matchType: r.match_type as RuleType, categoryId: r.category_id, priority: r.priority }));
  const byName = (n?: string) => (n ? (cats ?? []).find((c) => normText(c.name) === normText(n) || normText(displayName(x, c.name, c.system_key)) === normText(n))?.id ?? null : null);

  // Duplicados contra lo ya guardado (mismo día, importe y concepto) y dentro del propio archivo
  const existing = new Map<string, number>();
  if (parsed.rows.length) {
    const dates = parsed.rows.map((r) => r.date).sort();
    const { data: ex } = await supabase.from("expenses").select("spent_at, amount_cents, description").eq("space_id", spaceId.data).gte("spent_at", dates[0]!).lte("spent_at", dates[dates.length - 1]!).limit(5000);
    for (const e of ex ?? []) { const k = sha(dupKey(e.spent_at, e.amount_cents, e.description ?? "")); existing.set(k, (existing.get(k) ?? 0) + 1); }
  }
  const seen = new Set<string>();
  const rows: PreviewRow[] = parsed.rows.map((r) => {
    const k = sha(dupKey(r.date, r.amountCents, r.description));
    let duplicate: PreviewRow["duplicate"] = null;
    if ((existing.get(k) ?? 0) > 0) { existing.set(k, existing.get(k)! - 1); duplicate = "saved"; }
    else if (seen.has(k)) duplicate = "file";
    seen.add(k);
    return { line: r.line, date: r.date, description: r.description, amountCents: r.amountCents, categoryId: byName(r.category) ?? matchRule(ruleList, r.description)?.categoryId ?? null, duplicate };
  });
  return { format: parsed.format, rows, errors: parsed.errors.map((e) => ({ ...e, message: x(e.message) })), skipped: parsed.skipped, needsMapping: parsed.needsMapping, categories };
}

const confirmRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string().trim().min(1).max(120),
  amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS), categoryId: z.uuid().nullable(),
}).strict();
const confirmSchema = z.object({ spaceId: z.uuid(), rows: z.array(confirmRow).min(1).max(CSV_MAX_ROWS) }).strict();

/** Paso 2: guarda las filas elegidas. Cada una pasa por la misma ruta segura que un gasto normal. */
export async function confirmImport(input: unknown): Promise<{ ok: boolean; imported: number; failed: number; error?: string }> {
  const x = await getTx();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, imported: 0, failed: 0, error: x("Datos no válidos") };
  const { spaceId, rows } = parsed.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, imported: 0, failed: 0, error: x("Sesión caducada.") };
  if (!(await allow(RULES.importCsv, auth.user.id))) return { ok: false, imported: 0, failed: 0, error: x("Demasiados intentos. Espera un rato.") };

  const [{ data: space }, { data: members }, { data: cats }] = await Promise.all([
    supabase.from("spaces").select("base_currency, kind").eq("id", spaceId).maybeSingle(),
    supabase.from("space_members").select("id, user_id").eq("space_id", spaceId),
    supabase.from("categories").select("id").eq("space_id", spaceId),
  ]);
  if (!space || !members?.some((m) => m.user_id === auth.user!.id)) return { ok: false, imported: 0, failed: 0, error: x("No autorizado.") };
  const valid = new Set((cats ?? []).map((c) => c.id));
  if (rows.some((r) => r.categoryId && !valid.has(r.categoryId))) return { ok: false, imported: 0, failed: 0, error: x("Datos no válidos") };

  let imported = 0, failed = 0;
  const nth = new Map<string, number>();
  for (const r of rows) {
    const k = dupKey(r.date, r.amountCents, r.description);
    const n = nth.get(k) ?? 0; nth.set(k, n + 1);
    const res = await saveExpense({
      clientId: rowClientId(spaceId, k, n), spaceId, description: r.description, categoryId: r.categoryId, spentAt: r.date, amountCents: r.amountCents,
      currency: space.base_currency, paidFrom: "member", splitMode: "default", participants: members.map((m) => m.id), payers: [], isPrivate: false, tags: [],
    });
    if (res.ok) imported++; else failed++;
  }
  revalidatePath("/", "layout");
  return { ok: true, imported, failed };
}

export async function getImportSpaces() {
  const supabase = await createClient();
  const { data } = await supabase.from("spaces").select("id, name, kind").is("archived_at", null).order("created_at");
  return data ?? [];
}
