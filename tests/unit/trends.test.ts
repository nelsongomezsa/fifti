import { describe, expect, it } from "vitest";
import { computeTrends, type BreakdownRow } from "@/lib/trends";

const r = (month: string, categoryId: string | null, cents: number): BreakdownRow => ({ month, categoryId, cents });
const fundOf = { sup: "dia", res: "ocio", alq: "fijo" };

describe("tendencias", () => {
  const rows = [
    r("2025-11-01", "sup", 20000),
    r("2026-08-01", "sup", 30000), r("2026-09-01", "sup", 30000), r("2026-10-01", "sup", 30000),
    r("2026-08-01", "res", 10000), r("2026-09-01", "res", 10000), r("2026-10-01", "res", 10000),
    r("2026-11-01", "sup", 45000), r("2026-11-01", "res", 4000), r("2026-11-01", "alq", 60000),
  ];
  const t = computeTrends(rows, [], "2026-11-01", fundOf);

  it("compara con el mismo mes del año anterior y con la media de 3 meses", () => {
    expect(t.currentCents).toBe(109000);
    expect(t.lastYearCents).toBe(20000);
    expect(t.vsLastYearBp).toBe(44500); // +445 %
    expect(t.avg3Cents).toBe(40000);
    expect(t.vsAvg3Bp).toBe(17250);
  });
  it("categorías que más suben y bajan frente a la media de los 3 meses anteriores", () => {
    expect(t.up.map((m) => [m.categoryId, m.deltaCents])).toEqual([["alq", 60000 - 0], ["sup", 15000]]);
    expect(t.down.map((m) => [m.categoryId, m.deltaCents])).toEqual([["res", -6000]]);
  });
  it("sin datos del año anterior o de meses previos no inventa comparativas", () => {
    const e = computeTrends([r("2026-11-01", "sup", 1000)], [], "2026-11-01", fundOf);
    expect(e.lastYearCents).toBeNull();
    expect(e.avg3Cents).toBeNull();
    expect(e.vsLastYearBp).toBeNull();
  });
  it("ignora variaciones menores que el umbral", () => {
    const x = computeTrends([r("2026-10-01", "sup", 3000), r("2026-09-01", "sup", 3000), r("2026-08-01", "sup", 3000), r("2026-11-01", "sup", 3050)], [], "2026-11-01", fundOf);
    expect(x.up).toEqual([]);
  });
  it("12 meses por fondo, con el espejo personal y los gastos sin fondo", () => {
    const m = computeTrends([r("2026-11-01", "sup", 100), r("2026-11-01", null, 50)], [{ month: "2026-11-01", fundId: "ocio", cents: 70 }], "2026-11-01", fundOf);
    expect(m.months).toHaveLength(12);
    expect(m.months[11]).toBe("2026-11-01");
    expect(m.byFund[11]).toEqual({ dia: 100, none: 50, ocio: 70 });
    expect(m.fundIds[0]).toBe("dia");
  });
});
