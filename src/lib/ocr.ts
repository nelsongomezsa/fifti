"use client";

import { parseReceiptText } from "./receipt";

/**
 * OCR de tickets en el navegador con tesseract.js, todo servido desde nuestro dominio (/tesseract).
 * La foto no sale del dispositivo para esto. Solo devuelve una propuesta de importe y fecha.
 */
export async function scanReceipt(file: File): Promise<{ amountCents: number | null; date: string | null }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("spa", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang",
    gzip: true,
    workerBlobURL: false,
  });
  try {
    const { data } = await worker.recognize(file);
    return parseReceiptText(data.text);
  } finally {
    await worker.terminate();
  }
}
