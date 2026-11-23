"use server";

import { getTx } from "@/i18n/tx";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { MAX_RECEIPT_BYTES, sniffImageType } from "@/lib/security/image";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { rpcMessage } from "@/server/rpc-error";

export type ReceiptResult = { ok: true } | { ok: false; error: string };

/**
 * Sube el ticket de un gasto. Seguridad: máximo 5 MB, tipo REAL por magic bytes (no por el Content-Type),
 * recodificado a WebP (se descartan EXIF y cualquier metadato o carga útil), nombre aleatorio y bucket privado.
 */
export async function uploadReceipt(fd: FormData): Promise<ReceiptResult> {
  const x = await getTx();
  const expenseId = uuidSchema.safeParse(fd.get("expenseId"));
  const file = fd.get("file");
  if (!expenseId.success || !(file instanceof File)) return { ok: false, error: x("Datos no válidos") };
  if (file.size === 0 || file.size > MAX_RECEIPT_BYTES) return { ok: false, error: x("La foto debe pesar menos de 5 MB.") };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.upload, auth.user.id))) return { ok: false, error: x("Demasiadas fotos. Espera un rato.") };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImageType(bytes)) return { ok: false, error: x("Solo se admiten fotos JPG, PNG o WebP.") };

  let clean: Buffer;
  try {
    clean = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate() // aplica la orientación EXIF antes de descartarla
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer(); // sin .withMetadata(): se eliminan EXIF/GPS
  } catch {
    return { ok: false, error: x("No se ha podido procesar la foto.") };
  }

  const { data: exp } = await supabase.from("expenses").select("space_id").eq("id", expenseId.data).maybeSingle();
  if (!exp) return { ok: false, error: x("Gasto no encontrado.") };
  const path = `${exp.space_id}/${randomUUID()}.webp`;
  const { error: upErr } = await supabase.storage.from("receipts").upload(path, clean, { contentType: "image/webp", upsert: false });
  if (upErr) return { ok: false, error: x("No se ha podido guardar la foto.") };
  const { error } = await supabase.rpc("attach_receipt", { p_expense: expenseId.data, p_path: path });
  if (error) {
    await supabase.storage.from("receipts").remove([path]);
    return { ok: false, error: x(rpcMessage(error)) };
  }
  revalidatePath(`/movimientos/${expenseId.data}`);
  return { ok: true };
}
