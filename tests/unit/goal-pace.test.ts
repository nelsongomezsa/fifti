import { describe, expect, it } from "vitest";
import { goalPace } from "@/lib/goal-pace";

describe("ritmo de una meta", () => {
  it("acumula las aportaciones por fecha", () => {
    const p = goalPace([{ date: "2026-11-10", cents: 2500 }, { date: "2026-10-01", cents: 4000 }], 150000, "2026-11-24");
    expect(p.series).toEqual([{ date: "2026-10-01", totalCents: 4000 }, { date: "2026-11-10", totalCents: 6500 }]);
  });
  it("calcula el ritmo medio y la fecha estimada", () => {
    // 60 000 en 60 días = 2 meses → 30 000 al mes; faltan 90 000 → 3 meses (90 días)
    const p = goalPace([{ date: "2026-10-01", cents: 60000 }], 150000, "2026-11-30");
    expect(p.avgPerMonthCents).toBe(Math.round(60000 / (60 / 30)));
    expect(p.etaDate).toBe("2027-02-28");
    expect(p.reached).toBe(false);
  });
  it("una meta ya alcanzada no tiene fecha estimada", () => {
    const p = goalPace([{ date: "2026-10-01", cents: 300000 }], 300000, "2026-11-24");
    expect(p.reached).toBe(true);
    expect(p.etaDate).toBeNull();
  });
  it("sin aportaciones no hay ritmo ni fecha", () => {
    expect(goalPace([], 100000, "2026-11-24")).toEqual({ series: [], avgPerMonthCents: 0, etaDate: null, reached: false });
  });
  it("con menos de un mes de historia usa un mes mínimo (no se dispara)", () => {
    expect(goalPace([{ date: "2026-11-23", cents: 10000 }], 100000, "2026-11-24").avgPerMonthCents).toBe(10000);
  });
});
