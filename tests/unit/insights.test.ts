import { describe, expect, it } from "vitest";
import { fillSeries, fundLeftover, lastMonths, monthChange, savingsRateBp } from "@/lib/money";

describe("insights", () => {
  it("tasa de ahorro", () => {
    expect(savingsRateBp(200000, 150000)).toBe(2500);
    expect(savingsRateBp(200000, 250000)).toBe(-2500);
    expect(savingsRateBp(0, 100)).toBe(0);
  });
  it("variación frente al mes anterior", () => {
    expect(monthChange(12000, 10000)).toEqual({ deltaCents: 2000, percentBp: 2000 });
    expect(monthChange(5000, 0)).toEqual({ deltaCents: 5000, percentBp: null });
    expect(monthChange(-5000, -10000).percentBp).toBe(5000);
  });
  it("últimos 6 meses cruzando año", () => {
    expect(lastMonths("2026-02-01", 6)).toEqual(["2025-09-01", "2025-10-01", "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });
  it("rellena meses sin datos", () => {
    expect(fillSeries(["2026-01-01", "2026-02-01", "2026-03-01"], [{ month: "2026-02-01", total_cents: 500 }])).toEqual([0, 500, 0]);
  });
  it("sobrante de fondo con arrastre", () => {
    expect(fundLeftover(50000, 3000, 20000)).toBe(33000);
    expect(fundLeftover(50000, 0, 60000)).toBe(-10000);
  });
});
