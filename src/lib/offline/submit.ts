import { saveExpense, type SaveResult } from "@/server/actions/expenses";
import type { ExpenseInput } from "@/lib/validation/expense";
import { enqueue } from "./queue";

export const QUEUE_EVENT = "fifti:queue-changed";

async function queueIt(input: ExpenseInput): Promise<SaveResult> {
  try {
    await enqueue(input);
  } catch {
    return { ok: false, error: "Sin conexión y no se ha podido guardar en el dispositivo." };
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
  return { ok: true, id: "pending", shareCents: 0 };
}

/** Punto único de envío de gastos desde el cliente: sin red, el gasto va a la cola y se sube solo al volver la conexión. */
export async function submitExpense(input: ExpenseInput): Promise<SaveResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return queueIt(input);
  try {
    return await saveExpense(input);
  } catch {
    return queueIt(input);
  }
}
