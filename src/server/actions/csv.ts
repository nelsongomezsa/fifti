"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CSV_MAX_BYTES, CSV_MAX_ROWS, importRowSchema, previewImport, type ImportPreview, type ImportRow } from "@/lib/csv";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { saveExpense } from "./expenses";

/** Paso 1: lee y valida el CSV. No guarda nada; devuelve la vista previa para confirmar. */
export async function previewCsv(fd: FormData): Promise<ImportPreview & { fatal?: string }> {
  const file = fd.get("file");
  if (!(file instanceof File)) return { rows: [], errors: [], fatal: "Elige un archivo CSV." };
  if (file.size > CSV_MAX_BYTES) return { rows: [], errors: [], fatal: "El archivo es demasiado grande (máx. 1 MB)." };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { rows: [], errors: [], fatal: "Sesión caducada." };
  if (!(await allow(RULES.importCsv, data.user.id))) return { rows: [], errors: [], fatal: "Demasiados intentos. Espera un rato." };
  return previewImport(await file.text());
}

const confirmSchema = z.object({ spaceId: z.uuid(), rows: z.array(importRowSchema).min(1).max(CSV_MAX_ROWS) }).strict();

/** Paso 2: guarda las filas ya validadas. Cada una pasa por la misma ruta segura que un gasto normal. */
export async function confirmImport(input: unknown): Promise<{ ok: boolean; imported: number; failed: number; error?: string }> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, imported: 0, failed: 0, error: "Datos no válidos" };
  const { spaceId, rows } = parsed.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, imported: 0, failed: 0, error: "Sesión caducada." };
  if (!(await allow(RULES.importCsv, auth.user.id))) return { ok: false, imported: 0, failed: 0, error: "Demasiados intentos. Espera un rato." };

  const [{ data: space }, { data: members }, { data: cats }] = await Promise.all([
    supabase.from("spaces").select("base_currency, kind").eq("id", spaceId).maybeSingle(),
    supabase.from("space_members").select("id, user_id").eq("space_id", spaceId),
    supabase.from("categories").select("id, name").eq("space_id", spaceId),
  ]);
  if (!space || !members?.some((m) => m.user_id === auth.user!.id)) return { ok: false, imported: 0, failed: 0, error: "No autorizado." };
  const catId = (n?: string) => (n ? cats?.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id ?? null : null);

  let imported = 0, failed = 0;
  for (const r of rows as ImportRow[]) {
    const res = await saveExpense({
      clientId: crypto.randomUUID(), spaceId, description: r.description, categoryId: catId(r.category), spentAt: r.date, amountCents: r.amountCents,
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
