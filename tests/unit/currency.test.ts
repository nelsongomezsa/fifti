import { describe, expect, it } from "vitest";
import { CURRENCIES, currencyForLanguages, currencyLabel, parseFrankfurterSeries } from "@/lib/fx";
import { currencyDecimals, currencySymbol, formatAmount, formatMoney } from "@/lib/money";
import { createSpaceSchema } from "@/lib/validation/spaces";
import { DEMO_RATES } from "@/lib/demo/rates";
import { buildDemoDb } from "@/lib/demo/dataset";

const plain = (s: string) => s.replace(/\s/g, " ");

describe("formato por moneda", () => {
  it("cada moneda con su símbolo y sus decimales, en el idioma de la app", () => {
    expect(plain(formatMoney(123450, "AUD", "en-GB"))).toBe("A$1,234.50");
    expect(plain(formatMoney(123450, "AUD", "es-ES"))).toBe("1.234,50 AUD");
    expect(plain(formatMoney(123400, "JPY", "es-ES"))).toBe("1.234 JPY");
    expect(formatMoney(123400, "JPY", "en-GB")).toBe("JP¥1,234");
    expect(currencySymbol("GBP", "en-GB")).toBe("£");
  });
  it("el CSV usa los decimales de la moneda", () => {
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("AUD")).toBe(2);
    expect(formatAmount(123400, "es-ES", "JPY")).toBe("1.234");
    expect(formatAmount(123450, "es-ES", "AUD")).toBe("1.234,50");
  });
  it("el desplegable muestra código, símbolo y nombre", () => {
    expect(currencyLabel("AUD", "es-ES")).toMatch(/^AUD · .*dólar australiano$/);
    expect(currencyLabel("EUR", "en-GB")).toBe("EUR · € · Euro");
    for (const c of CURRENCIES) expect(DEMO_RATES[c], c).toBeGreaterThan(0);
  });
});

describe("moneda propuesta y validación", () => {
  it("según la región del navegador; sin una clara, euros", () => {
    expect(currencyForLanguages("en-AU,en;q=0.9")).toBe("AUD");
    expect(currencyForLanguages("en-US")).toBe("USD");
    expect(currencyForLanguages("es-ES,es;q=0.9")).toBe("EUR");
    expect(currencyForLanguages("es")).toBe("EUR");
    expect(currencyForLanguages(null)).toBe("EUR");
  });
  it("el servidor solo admite monedas de la lista", () => {
    const base = { name: "Viaje Lisboa", kind: "group" };
    expect(createSpaceSchema.parse({ ...base, currency: "aud" }).currency).toBe("AUD");
    expect(createSpaceSchema.safeParse({ ...base, currency: "XXX" }).success).toBe(false);
  });
});

describe("serie de cambios", () => {
  it("se queda con los días válidos", () => {
    const json = { rates: { "2026-11-09": { AUD: 1.6 }, "2026-11-10": { AUD: -1 }, otro: { AUD: 2 } } };
    expect(parseFrankfurterSeries(json, "AUD")).toEqual([{ day: "2026-11-09", rate: 1.6 }]);
    expect(parseFrankfurterSeries(null, "AUD")).toEqual([]);
  });
});

describe("demo", () => {
  it("tiene una cuenta en AUD y gastos en AUD y USD que cuadran en la moneda del espacio", () => {
    const db = buildDemoDb(new Date("2026-11-20T12:00:00Z"));
    expect(db.accounts!.some((a) => a.currency === "AUD")).toBe(true);
    const foreign = db.expenses!.filter((e) => e.currency !== "EUR");
    expect(new Set(foreign.map((e) => e.currency))).toEqual(new Set(["AUD", "USD"]));
    for (const e of foreign) {
      expect(e.amount_base_cents).toBe(Math.round(Number(e.amount_cents) * Number(e.fx_rate)));
      expect(db.expense_splits!.filter((s) => s.expense_id === e.id).reduce((a, s) => a + Number(s.amount_cents), 0)).toBe(e.amount_base_cents);
    }
  });
});
