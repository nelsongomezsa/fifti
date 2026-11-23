import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { enqueue, flushQueue, listQueue, removeItem, MAX_ATTEMPTS } from "@/lib/offline/queue";
import type { ExpenseInput } from "@/lib/validation/expense";

const mk = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  clientId: crypto.randomUUID(), spaceId: crypto.randomUUID(), description: "Café", spentAt: "2026-11-10", amountCents: 250,
  currency: "EUR", paidFrom: "member", splitMode: "equal", participants: [crypto.randomUUID()], payers: [], isPrivate: false, tags: [], ...over,
});

beforeEach(async () => { for (const i of await listQueue()) await removeItem(i.clientId); });

describe("cola offline", () => {
  it("guarda y lista en orden", async () => {
    const a = mk(), b = mk();
    await enqueue(a); await new Promise((r) => setTimeout(r, 2)); await enqueue(b);
    expect((await listQueue()).map((i) => i.clientId)).toEqual([a.clientId, b.clientId]);
  });
  it("encolar dos veces el mismo clientId no duplica", async () => {
    const a = mk();
    await enqueue(a); await enqueue(a);
    expect(await listQueue()).toHaveLength(1);
  });
  it("sincroniza y vacía la cola; reenviar no duplica (el servidor es idempotente)", async () => {
    const sentIds: string[] = [];
    await enqueue(mk()); await enqueue(mk());
    const r = await flushQueue(async (i) => { sentIds.push(i.clientId); return { ok: true, id: "x" }; });
    expect(r).toMatchObject({ sent: 2, failed: 0, remaining: 0 });
    expect((await flushQueue(async () => ({ ok: true, id: "x" }))).sent).toBe(0);
  });
  it("un error de red detiene el envío y conserva los gastos", async () => {
    await enqueue(mk()); await enqueue(mk());
    const r = await flushQueue(async () => { throw new TypeError("fetch failed"); });
    expect(r).toMatchObject({ sent: 0, offline: true, remaining: 2 });
    expect((await listQueue())[0]!.attempts).toBe(1);
  });
  it("un rechazo del servidor marca el gasto como fallido sin bloquear el resto", async () => {
    const bad = mk(), good = mk();
    await enqueue(bad); await new Promise((r) => setTimeout(r, 2)); await enqueue(good);
    const r = await flushQueue(async (i) => (i.clientId === bad.clientId ? { ok: false, error: "Importe no válido" } : { ok: true, id: "ok" }));
    expect(r).toMatchObject({ sent: 1, failed: 1, remaining: 0 });
    const left = await listQueue();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ status: "failed", error: "Importe no válido" });
  });
  it("tras demasiados intentos se marca como fallido", async () => {
    await enqueue(mk());
    for (let i = 0; i < MAX_ATTEMPTS; i++) await flushQueue(async () => { throw new Error("net"); });
    expect((await listQueue())[0]!.status).toBe("failed");
  });
});
