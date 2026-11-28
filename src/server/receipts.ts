import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDemoRequest } from "@/lib/demo/mode";

/**
 * Limpieza de fotos de tickets en el bucket privado. La política del bucket solo deja borrar a quien subió la foto, así que
 * se hace con permisos de servidor: quien llama debe haber comprobado ANTES que la persona puede cambiar o borrar ese gasto.
 * Las rutas salen siempre de la base de datos, nunca del navegador. Un fallo aquí se registra y no deshace la operación.
 */
const BUCKET = "receipts";
const log = (what: string, err: unknown) => console.error(`[receipts] ${what}`, err instanceof Error ? err.message : "error");

export type Receipts = { spaceId: string; paths: string[] };

/** Fotos que tiene ahora un gasto (la pública o la del detalle privado). */
export async function receiptsOf(expenseId: string): Promise<Receipts | null> {
  if (await isDemoRequest()) return null;
  const admin = createAdminClient();
  const [{ data: expense }, { data: details }] = await Promise.all([
    admin.from("expenses").select("space_id, receipt_path").eq("id", expenseId).maybeSingle(),
    admin.from("expense_private_details").select("receipt_path").eq("expense_id", expenseId).maybeSingle(),
  ]);
  if (!expense) return null;
  return { spaceId: expense.space_id, paths: [expense.receipt_path, details?.receipt_path].filter((p): p is string => !!p) };
}

/** Borra las fotos que ya no usa ningún gasto. Solo dentro de la carpeta de su espacio. */
export async function removeUnusedReceipts(receipts: Receipts | null): Promise<void> {
  if (!receipts) return;
  const mine = receipts.paths.filter((p) => p.startsWith(`${receipts.spaceId}/`));
  if (mine.length === 0) return;
  try {
    const admin = createAdminClient();
    const [a, b] = await Promise.all([
      admin.from("expenses").select("receipt_path").in("receipt_path", mine),
      admin.from("expense_private_details").select("receipt_path").in("receipt_path", mine),
    ]);
    // Si no se puede saber quién la usa, no se borra
    if (a.error || b.error) throw new Error("no se pudo comprobar el uso");
    const used = new Set([...a.data, ...b.data].map((r) => r.receipt_path as string));
    const orphans = mine.filter((p) => !used.has(p));
    if (orphans.length === 0) return;
    const { error } = await admin.storage.from(BUCKET).remove(orphans);
    if (error) throw error;
  } catch (err) {
    log("no se pudo borrar una foto", err);
  }
}

/** De estos espacios, borra las fotos de los que ya no existen. */
export async function removeReceiptsOfDeletedSpaces(spaceIds: string[]): Promise<void> {
  if (spaceIds.length === 0 || (await isDemoRequest())) return;
  const { data, error } = await createAdminClient().from("spaces").select("id").in("id", spaceIds);
  if (error) return log("no se pudo saber qué espacios quedan", error);
  const alive = new Set(data.map((s) => s.id as string));
  for (const id of spaceIds.filter((s) => !alive.has(s))) await removeSpaceReceipts(id);
}

/** Todas las fotos de un espacio: al vaciarlo o al desaparecer, ya no queda ningún gasto que las use. */
export async function removeSpaceReceipts(spaceId: string): Promise<void> {
  if (await isDemoRequest()) return;
  try {
    const storage = createAdminClient().storage.from(BUCKET);
    for (let round = 0; round < 50; round++) {
      const { data, error } = await storage.list(spaceId, { limit: 100 });
      if (error) throw error;
      if (!data || data.length === 0) return;
      const removed = await storage.remove(data.map((f) => `${spaceId}/${f.name}`));
      if (removed.error) throw removed.error;
    }
  } catch (err) {
    log("no se pudieron borrar las fotos del espacio", err);
  }
}
