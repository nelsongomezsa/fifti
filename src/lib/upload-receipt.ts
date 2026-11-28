import { MAX_RECEIPT_BYTES } from "@/lib/security/image";

export type ReceiptResult = { ok: true } | { ok: false; error: string };

/**
 * Las fotos del móvil pesan varios megas y Vercel no admite peticiones de más de 4,5 MB: se reducen en el dispositivo.
 * Es solo comodidad; el servidor vuelve a comprobar tamaño y tipo y es quien quita los metadatos.
 */
async function shrink(file: File): Promise<File> {
  if (file.size <= 1_000_000) return file;
  try {
    const image = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], "ticket.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** Sube la foto a /api/ticket. `x` traduce los avisos que se generan en el dispositivo; los del servidor ya vienen traducidos. */
export async function uploadReceipt(expenseId: string, file: File, x: (text: string) => string): Promise<ReceiptResult> {
  const photo = await shrink(file);
  if (photo.size > MAX_RECEIPT_BYTES) return { ok: false, error: x("La foto debe pesar menos de 4 MB.") };
  const body = new FormData();
  body.set("expenseId", expenseId);
  body.set("file", photo);
  try {
    const response = await fetch("/api/ticket", { method: "POST", body, credentials: "same-origin" });
    const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? x("No se ha podido guardar la foto.") };
  } catch {
    return { ok: false, error: x("No se ha podido guardar la foto.") };
  }
}
