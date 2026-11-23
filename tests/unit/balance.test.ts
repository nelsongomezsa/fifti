import { describe, expect, it } from "vitest";
import { computeBalances, paymentConcept, proposeOffset, simplifyDebts, whoPaysNext, zeroOutPayments, type BalanceExpense } from "@/lib/money";

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const exp = (payer: string, total: number, split: Record<string, number>): BalanceExpense => ({
  paidFrom: "member", payers: [{ memberId: payer, amountCents: total }], splits: Object.entries(split).map(([memberId, amountCents]) => ({ memberId, amountCents })),
});

describe("saldos", () => {
  it("pagado − le toca, y suman cero", () => {
    const b = computeBalances(["a", "b", "c"], [exp("a", 3000, { a: 1000, b: 1000, c: 1000 })]);
    expect(b).toEqual({ a: 2000, b: -1000, c: -1000 });
    expect(sum(b)).toBe(0);
  });
  it("varios pagadores", () => {
    const e: BalanceExpense = { paidFrom: "member", payers: [{ memberId: "a", amountCents: 600 }, { memberId: "b", amountCents: 400 }], splits: [{ memberId: "a", amountCents: 500 }, { memberId: "b", amountCents: 500 }] };
    expect(computeBalances(["a", "b"], [e])).toEqual({ a: 100, b: -100 });
  });
  it("los gastos del bote no crean deudas", () => {
    const e: BalanceExpense = { paidFrom: "pot", payers: [], splits: [{ memberId: "a", amountCents: 500 }, { memberId: "b", amountCents: 500 }] };
    expect(computeBalances(["a", "b"], [e])).toEqual({ a: 0, b: 0 });
  });
  it("las liquidaciones compensan", () => {
    const b = computeBalances(["a", "b"], [exp("a", 1000, { a: 500, b: 500 })], [{ fromMemberId: "b", toMemberId: "a", amountCents: 500 }]);
    expect(b).toEqual({ a: 0, b: 0 });
  });
  it("rechaza miembros desconocidos", () => {
    expect(() => computeBalances(["a"], [exp("z", 100, { a: 100 })])).toThrow();
  });
});

describe("simplificación de deudas", () => {
  it("deja a todos a cero con pocos pagos", () => {
    const bal = { a: 5000, b: -2000, c: -3000, d: 0 };
    const t = simplifyDebts(bal);
    expect(t.length).toBeLessThanOrEqual(2);
    const after = { ...bal };
    for (const x of t) { after[x.from as "a"] += x.amountCents; after[x.to as "a"] -= x.amountCents; }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });
  it("propiedad: siempre liquida y nunca usa más de n−1 pagos", () => {
    for (let k = 0; k < 300; k++) {
      const n = 2 + Math.floor(Math.random() * 7);
      const raw = Array.from({ length: n - 1 }, () => Math.floor(Math.random() * 20000) - 10000);
      const bal: Record<string, number> = Object.fromEntries(raw.map((v, i) => [`m${i}`, v]));
      bal[`m${n - 1}`] = -raw.reduce((a, b) => a + b, 0);
      const t = simplifyDebts(bal);
      expect(t.length).toBeLessThanOrEqual(n - 1);
      const after = { ...bal };
      for (const x of t) { after[x.from]! += x.amountCents; after[x.to]! -= x.amountCents; expect(x.amountCents).toBeGreaterThan(0); }
      expect(Object.values(after).every((v) => v === 0)).toBe(true);
    }
  });
  it("sin deudas no hay pagos", () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
    expect(whoPaysNext({ a: 0, b: 0 })).toBeNull();
  });
  it("¿quién paga ahora? es quien más debe", () => {
    expect(whoPaysNext({ a: 3000, b: -1000, c: -2000 })).toBe("c");
  });
  it("modo a cero = pagos exactos", () => {
    expect(zeroOutPayments({ a: 1000, b: -1000 })).toEqual([{ from: "b", to: "a", amountCents: 1000 }]);
  });
  it("concepto acotado", () => {
    expect(paymentConcept("Viaje Lisboa", "Leo")).toBe("Fifti Viaje Lisboa - Leo");
    expect(paymentConcept("x".repeat(100), "Leo").length).toBe(60);
  });
});

describe("compensación entre grupos", () => {
  const memberOf = (s: string, u: string) => `${s}:${u}`;
  it("Leo debe 30 en Lisboa, yo debo 20 en Hogar → compensa 20 y queda que Leo pague 10", () => {
    const r = proposeOffset("yo", "leo", [
      { spaceId: "lisboa", from: "leo", to: "yo", amountCents: 3000 },
      { spaceId: "hogar", from: "yo", to: "leo", amountCents: 2000 },
    ], memberOf)!;
    expect(r.amountCents).toBe(2000);
    expect(r.remaining).toEqual({ from: "leo", to: "yo", amountCents: 1000 });
    // en cada sentido suma lo mismo
    const ab = r.lines.filter((l) => l.fromMemberId.endsWith(":yo")).reduce((a, b) => a + b.amountCents, 0);
    const ba = r.lines.filter((l) => l.fromMemberId.endsWith(":leo")).reduce((a, b) => a + b.amountCents, 0);
    expect(ab).toBe(ba);
  });
  it("sin deudas en los dos sentidos no hay propuesta", () => {
    expect(proposeOffset("a", "b", [{ spaceId: "g", from: "a", to: "b", amountCents: 100 }], memberOf)).toBeNull();
  });
  it("reparte el importe entre varios grupos", () => {
    const r = proposeOffset("a", "b", [
      { spaceId: "g1", from: "a", to: "b", amountCents: 500 }, { spaceId: "g2", from: "a", to: "b", amountCents: 700 },
      { spaceId: "g3", from: "b", to: "a", amountCents: 900 },
    ], memberOf)!;
    expect(r.amountCents).toBe(900);
    expect(r.lines.filter((l) => l.fromMemberId.endsWith(":a")).map((l) => l.amountCents)).toEqual([500, 400]);
    expect(r.remaining).toEqual({ from: "a", to: "b", amountCents: 300 });
  });
});
