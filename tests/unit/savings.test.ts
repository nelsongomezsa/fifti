import { describe, expect, it } from "vitest";
import { challenge52, goalProgress, monthlyNeeded, monthsUntil, percentOfIncome, roundUpCents } from "@/lib/money";

describe("ahorro", () => {
  it("progreso con hitos pagados a proveedores", () => {
    const p = goalProgress(2000000, 500000, [{ amountCents: 150000, paid: true }, { amountCents: 300000, paid: false }]);
    expect(p).toEqual({ contributed: 500000, available: 350000, remaining: 1500000, pctBp: 2500, unpaidMilestones: 300000 });
  });
  it("el progreso no pasa del 100 %", () => {
    expect(goalProgress(1000, 5000).pctBp).toBe(10000);
    expect(goalProgress(1000, 5000).remaining).toBe(0);
  });
  it("cuánto ahorrar al mes hasta la fecha", () => {
    expect(monthsUntil("2027-05-20", "2026-11-23")).toBe(7);
    expect(monthsUntil("2026-11-30", "2026-11-23")).toBe(1);
    expect(monthsUntil("2026-01-01", "2026-11-23")).toBe(1);
    expect(monthlyNeeded(1000000, "2027-05-20", "2026-11-23")).toBe(Math.ceil(1000000 / 7));
    expect(monthlyNeeded(0, "2027-05-20", "2026-11-23")).toBe(0);
    expect(monthlyNeeded(1000, null, "2026-11-23")).toBe(0);
  });
  it("redondeo al siguiente euro", () => {
    expect(roundUpCents(1234)).toBe(66);
    expect(roundUpCents(1200)).toBe(0);
    expect(roundUpCents(1234, 500)).toBe(266);
    expect(() => roundUpCents(100, 0)).toThrow();
  });
  it("% del ingreso", () => { expect(percentOfIncome(180000, 1000)).toBe(18000); });
  it("reto de 52 semanas suma 1.378 pasos", () => {
    const c = challenge52(100);
    expect(c).toHaveLength(52);
    expect(c[0]!.amountCents).toBe(100);
    expect(c[51]!.cumulativeCents).toBe(137800);
  });
});
