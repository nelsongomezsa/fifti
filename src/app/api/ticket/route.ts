import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { MAX_RECEIPT_BYTES, sniffImageType } from "@/lib/security/image";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/server/rpc-error";

/**
 * Única función de la app que lleva sharp (ver next.config.ts). Por eso la subida vive aquí y no en una server action:
 * una action comparte módulo con todas las demás y un paquete que falte las tumba todas.
 */
export const runtime = "nodejs";

const fields = z.strictObject({ expenseId: z.uuid(), file: z.instanceof(File) });
const reply = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function recode(bytes: Uint8Array | null): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const input = bytes
    ? sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
    : sharp({ create: { width: 2, height: 2, channels: 3, background: "#000000" } });
  return input
    .rotate() // aplica la orientación EXIF antes de descartarla
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer(); // sin .withMetadata(): se eliminan EXIF y GPS
}

/** Comprobación tras desplegar: ¿puede esta función procesar imágenes? No lee ni escribe datos. */
export async function GET() {
  try {
    await recode(null);
    return reply(200, { ok: true });
  } catch (err) {
    console.error("[ticket]", err instanceof Error ? err.message.split("\n")[0] : "error");
    return reply(500, { ok: false });
  }
}

/** Un formulario de otra web no puede subir en nombre de nadie (las server actions lo comprueban solas; aquí a mano). */
function sameOrigin(request: NextRequest): boolean {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(request.headers.get("origin") ?? "").host === host;
  } catch {
    return false;
  }
}

/**
 * Sube la foto del ticket de un gasto: misma procedencia, sesión, permiso sobre el gasto, límite de uso, máximo 4 MB,
 * tipo REAL por sus primeros bytes, recodificada a WebP sin metadatos, nombre aleatorio y bucket privado
 * (solo se ve con una URL firmada de pocos minutos).
 */
export async function POST(request: NextRequest) {
  const x = await getTx();
  const fail = (status: number, message: string) => reply(status, { ok: false, error: x(message) });
  if (!sameOrigin(request)) return fail(403, "No autorizado.");
  const length = Number(request.headers.get("content-length"));
  // Margen de 64 KB para las cabeceras del multipart; se corta antes de leer el cuerpo
  if (!length || length > MAX_RECEIPT_BYTES + 65_536) return fail(413, "La foto debe pesar menos de 4 MB.");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return fail(401, "Sesión caducada.");
  if (user.app_metadata?.demo === true) return fail(403, "Crea una cuenta para guardar");
  if (!(await allow(RULES.upload, user.id))) return fail(429, "Demasiadas fotos. Espera un rato.");

  const form = await request.formData().catch(() => null);
  const parsed = fields.safeParse(form ? Object.fromEntries(form) : null);
  if (!parsed.success) return fail(400, "Datos no válidos");
  const { expenseId, file } = parsed.data;
  if (file.size === 0 || file.size > MAX_RECEIPT_BYTES) return fail(413, "La foto debe pesar menos de 4 MB.");

  // Permiso antes de procesar nada: la misma regla que en la base (attach_receipt la vuelve a aplicar)
  const { data: expense } = await supabase.from("expenses").select("space_id, is_private, created_by_member").eq("id", expenseId).maybeSingle();
  if (!expense) return fail(404, "Gasto no encontrado.");
  const { data: me } = await supabase.from("space_members").select("id, role").eq("space_id", expense.space_id).eq("user_id", user.id).maybeSingle();
  if (!me || ((me.role === "guest" || expense.is_private) && expense.created_by_member !== me.id)) return fail(403, "No autorizado.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImageType(bytes)) return fail(415, "Solo se admiten fotos JPG, PNG o WebP.");

  let clean: Buffer;
  try {
    clean = await recode(bytes);
  } catch (err) {
    console.error("[ticket]", err instanceof Error ? err.message.split("\n")[0] : "error");
    return fail(422, "No se ha podido procesar la foto.");
  }

  const path = `${expense.space_id}/${randomUUID()}.webp`;
  const { error: uploadError } = await supabase.storage.from("receipts").upload(path, clean, { contentType: "image/webp", upsert: false });
  if (uploadError) return fail(500, "No se ha podido guardar la foto.");
  const { error } = await supabase.rpc("attach_receipt", { p_expense: expenseId, p_path: path });
  if (error) {
    await supabase.storage.from("receipts").remove([path]);
    return fail(500, rpcMessage(error));
  }
  revalidatePath(`/movimientos/${expenseId}`);
  return reply(200, { ok: true });
}
