import { describe, expect, it } from "vitest";
import { savingsSeries } from "@/lib/savings-series";

describe("savingsSeries", () => {
  it("combina gasto y espejo, admite sobrante negativo y deja vacío sin ingresos", () => {
    expect(savingsSeries(
      ["2026-01-01", "2026-02-01", "2026-03-01"],
      [{ month: "2026-01-01", total_cents: 10000 }, { month: "2026-02-01", total_cents: 5000 }],
      [{ month: "2026-01-01", total_cents: 2500 }, { month: "2026-02-01", total_cents: 6000 }],
      [{ month: "2026-01-01", total_cents: 500 }],
    )).toEqual([
      { month: "2026-01-01", income: 10000, spent: 3000, leftover: 7000, rateBp: 7000 },
      { month: "2026-02-01", income: 5000, spent: 6000, leftover: -1000, rateBp: -2000 },
      { month: "2026-03-01", income: 0, spent: 0, leftover: 0, rateBp: null },
    ]);
  });
});
