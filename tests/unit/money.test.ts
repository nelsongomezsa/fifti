import { describe, expect, it } from "vitest";
import {
  addMonths, allocate, applyBasisPoints, formatMoney, isMonthStart, monthStart,
  parseToCents, splitByBasisPoints, splitEqual, sumsToHundredPercent, toBasisPoints,
} from "@/lib/money";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("allocate", () => {
  it("reparte 100 entre 3 sin perder céntimos", () => {
    const r = splitEqual(100, 3);
    expect(r).toEqual([34, 33, 33]);
    expect(sum(r)).toBe(100);
  });
  it("la suma siempre es el total (propiedad)", () => {
    for (let t = 0; t < 500; t++) {
      const total = Math.floor(Math.random() * 1_000_000);
      const n = 1 + Math.floor(Math.random() * 9);
      const weights = Array.from({ length: n }, () => Math.floor(Math.random() * 5000));
      if (sum(weights) === 0) continue;
      expect(sum(allocate(total, weights))).toBe(total);
    }
  });
  it("respeta pesos desiguales", () => {
    expect(allocate(1000, [7000, 3000])).toEqual([700, 300]);
  });
  it("no asigna nada a peso 0", () => {
    expect(allocate(101, [1, 0, 1])).toEqual([51, 0, 50]);
  });
  it("importes negativos son simétricos", () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });
  it("rechaza entradas inválidas", () => {
    expect(() => allocate(10.5, [1])).toThrow();
    expect(() => allocate(10, [])).toThrow();
    expect(() => allocate(10, [0, 0])).toThrow();
    expect(() => allocate(10, [-1, 2])).toThrow();
  });
  it("no desborda con importes grandes", () => {
    const r = allocate(100_000_000_000, [3333, 3333, 3334]);
    expect(sum(r)).toBe(100_000_000_000);
  });
});

describe("porcentajes en puntos básicos", () => {
  it("valida que sumen 100 %", () => {
    expect(sumsToHundredPercent([5000, 5000])).toBe(true);
    expect(sumsToHundredPercent([5000, 4999])).toBe(false);
    expect(sumsToHundredPercent([])).toBe(false);
  });
  it("reparte por bp", () => {
    expect(splitByBasisPoints(1000, [6000, 4000])).toEqual([600, 400]);
    expect(() => splitByBasisPoints(1000, [6000, 3000])).toThrow();
  });
  it("convierte y aplica", () => {
    expect(toBasisPoints(25, 100)).toBe(2500);
    expect(applyBasisPoints(1000, 2500)).toBe(250);
  });
});

describe("formato", () => {
  it("parsea importes", () => {
    expect(parseToCents("12,50")).toBe(1250);
    expect(parseToCents("12.5")).toBe(1250);
    expect(parseToCents("7")).toBe(700);
    expect(parseToCents("1,234")).toBeNull();
    expect(parseToCents("-3")).toBeNull();
    expect(parseToCents("abc")).toBeNull();
  });
  it("formatea en euros", () => {
    expect(formatMoney(6420).replace(/\s/g, " ")).toBe("64,20 €");
  });
});

describe("meses", () => {
  it("usa el primer día", () => {
    expect(monthStart(new Date(Date.UTC(2026, 10, 23)))).toBe("2026-11-01");
    expect(isMonthStart("2026-11-01")).toBe(true);
    expect(isMonthStart("2026-11-02")).toBe(false);
    expect(isMonthStart("2026-13-01")).toBe(false);
    expect(addMonths("2026-11-01", 2)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });
});

import { currencySymbol, formatAmount, groupTyped } from "@/lib/money";
describe("formato de dinero (único helper)", () => {
  const n = (s: string) => s.replace(/\s/g, " "); // espacios no separables → normales
  it("agrupa miles también con 4 cifras en español", () => {
    expect(n(formatMoney(210000))).toBe("2.100,00 €");
    expect(n(formatMoney(171500))).toBe("1.715,00 €");
    expect(n(formatMoney(99900))).toBe("999,00 €");
    expect(n(formatMoney(123456789))).toBe("1.234.567,89 €");
  });
  it("y en inglés", () => {
    expect(formatMoney(210000, "EUR", "en-GB")).toBe("€2,100.00");
    expect(formatMoney(171500, "USD", "en-GB")).toBe("US$1,715.00");
  });
  it("importes negativos", () => { expect(n(formatMoney(-210000))).toBe("-2.100,00 €"); });
  it("número solo para CSV", () => {
    expect(formatAmount(210000)).toBe("2.100,00");
    expect(formatAmount(210000, "en-GB")).toBe("2,100.00");
    expect(formatAmount(5)).toBe("0,05");
  });
  it("el CSV exportado se vuelve a importar igual", () => {
    expect(parseToCents("2100,50")).toBe(210050);
  });
  it("símbolo y agrupado al teclear", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(groupTyped("2100,5")).toBe("2.100,5");
    expect(groupTyped("1234567")).toBe("1.234.567");
    expect(groupTyped("2100", "en-GB")).toBe("2,100");
    expect(groupTyped("")).toBe("");
  });
});
