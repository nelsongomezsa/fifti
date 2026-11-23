import { describe, expect, it } from "vitest";
import { CURRENCIES, dailyBudgetLeft, isCurrency, parseFrankfurter } from "@/lib/fx";
import { toBase } from "@/lib/money";

describe("tipos de cambio", () => {
  it("lee la respuesta de Frankfurter", () => {
    expect(parseFrankfurter({ amount: 1, base: "USD", rates: { EUR: 0.92341234567 } }, "EUR")).toBe(0.92341235);
  });
  it("rechaza respuestas raras o hostiles", () => {
    expect(parseFrankfurter(null, "EUR")).toBeNull();
    expect(parseFrankfurter({}, "EUR")).toBeNull();
    expect(parseFrankfurter({ rates: { EUR: "0.9" } }, "EUR")).toBeNull();
    expect(parseFrankfurter({ rates: { EUR: -1 } }, "EUR")).toBeNull();
    expect(parseFrankfurter({ rates: { EUR: 0 } }, "EUR")).toBeNull();
    expect(parseFrankfurter({ rates: { EUR: 1e9 } }, "EUR")).toBeNull();
    expect(parseFrankfurter({ rates: { EUR: NaN } }, "EUR")).toBeNull();
  });
  it("lista blanca de monedas", () => {
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("XXX")).toBe(false);
    expect(isCurrency("usd")).toBe(false);
    expect(CURRENCIES).toContain("EUR");
  });
  it("convierte a moneda base y redondea al céntimo", () => {
    expect(toBase(10000, 0.92341235)).toBe(9234);
  });
  it("presupuesto por persona y día", () => {
    // 50 €/persona/día, 4 personas, 20 € ya gastados hoy → 45 € por cabeza
    expect(dailyBudgetLeft(5000, 4, 2000)).toBe(4500);
    expect(dailyBudgetLeft(5000, 4, 30000)).toBe(-2500);
    expect(dailyBudgetLeft(5000, 0, 0)).toBe(0);
  });
});
