import type { ExpenseInput } from "@/lib/validation/expense";

/**
 * Cola offline de gastos en IndexedDB. Cada gasto lleva un `clientId` generado en el cliente:
 * el servidor lo trata como clave de idempotencia, así que reenviar nunca duplica.
 */
export type QueueItem = {
  clientId: string;
  input: ExpenseInput;
  createdAt: number;
  attempts: number;
  status: "pending" | "failed";
  error?: string;
};
export type SendResult = { ok: true; id: string } | { ok: false; error: string };
export type Sender = (input: ExpenseInput) => Promise<SendResult>;

const DB = "fifti-offline";
const STORE = "outbox";
export const MAX_ATTEMPTS = 8;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

export async function enqueue(input: ExpenseInput): Promise<void> {
  const item: QueueItem = { clientId: input.clientId, input, createdAt: Date.now(), attempts: 0, status: "pending" };
  await tx("readwrite", (s) => s.put(item));
}
export const listQueue = (): Promise<QueueItem[]> =>
  tx("readonly", (s) => s.getAll() as IDBRequest<QueueItem[]>).then((l) => l.sort((a, b) => a.createdAt - b.createdAt));
export const removeItem = (clientId: string) => tx("readwrite", (s) => s.delete(clientId));
const putItem = (item: QueueItem) => tx("readwrite", (s) => s.put(item));

export type FlushSummary = { sent: number; failed: number; remaining: number; offline: boolean };

/**
 * Envía los gastos pendientes en orden. Un error de red detiene el envío y deja todo como estaba;
 * un rechazo del servidor (datos no válidos) marca ese gasto como fallido para que el usuario lo vea.
 */
export async function flushQueue(send: Sender): Promise<FlushSummary> {
  const items = (await listQueue()).filter((i) => i.status === "pending");
  let sent = 0, failed = 0, offline = false;
  for (const item of items) {
    try {
      const res = await send(item.input);
      if (res.ok) {
        await removeItem(item.clientId);
        sent++;
      } else {
        await putItem({ ...item, status: "failed", error: res.error, attempts: item.attempts + 1 });
        failed++;
      }
    } catch {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await putItem({ ...item, status: "failed", error: "No se ha podido enviar tras varios intentos.", attempts });
        failed++;
      } else {
        await putItem({ ...item, attempts });
      }
      offline = true;
      break;
    }
  }
  const remaining = (await listQueue()).filter((i) => i.status === "pending").length;
  return { sent, failed, remaining, offline };
}
