import { describe, expect, it } from "vitest";
import { contributionTargets, daysInMonth, forecastMonthEnd, monthOutlook, plannedSavingsBp, fundStatus, plannedFor, potBalance, summarizeFund } from "@/lib/money";

describe("plan por fondos", () => {
  it("reparte por % con mayor resto y por importe tal cual", () => {
    const r = plannedFor(200000, [
      { fundId: "fijos", mode: "percent", value: 5000 }, { fundId: "dia", mode: "percent", value: 3000 },
      { fundId: "ahorro", mode: "percent", value: 1000 }, { fundId: "ocio", mode: "amount", value: 7000 },
    ]);
    expect(r.map((x) => x.plannedCents)).toEqual([100000, 60000, 20000, 7000]);
  });
  it("los % suman exacto el total asignado aunque no cuadren los céntimos", () => {
    const r = plannedFor(100001, [{ fundId: "a", mode: "percent", value: 3333 }, { fundId: "b", mode: "percent", value: 3333 }, { fundId: "c", mode: "percent", value: 3334 }]);
    expect(r.reduce((a, b) => a + b.plannedCents, 0)).toBe(100001);
  });
  it("rechaza más del 100 %", () => {
    expect(() => plannedFor(1000, [{ fundId: "a", mode: "percent", value: 6000 }, { fundId: "b", mode: "percent", value: 5000 }])).toThrow();
  });
  it("avisos al 80 % y al 100 %", () => {
    expect(fundStatus(1000, 799)).toBe("ok");
    expect(fundStatus(1000, 800)).toBe("warn");
    expect(fundStatus(1000, 999)).toBe("warn");
    expect(fundStatus(1000, 1000)).toBe("over");
    expect(fundStatus(0, 0)).toBe("ok");
    expect(fundStatus(0, 1)).toBe("over");
  });
  it("resumen de fondo: previsto, gastado, restante y %", () => {
    expect(summarizeFund("f", 50000, 32100)).toMatchObject({ remaining: 17900, usedBp: 6420, status: "ok" });
    expect(summarizeFund("f", 50000, 60000)).toMatchObject({ remaining: -10000, usedBp: 12000, status: "over" });
  });
});

describe("previsión de fin de mes", () => {
  it("extrapola el ritmo variable y suma los fijos pendientes", () => {
    expect(daysInMonth("2026-11-01")).toBe(30);
    const f = forecastMonthEnd({ monthIso: "2026-11-01", today: "2026-11-10", spentVariable: 20000, spentFixed: 50000, plannedFixed: 80000, income: 200000 });
    expect(f.projectedSpend).toBe(60000 + 80000);
    expect(f.projectedLeftover).toBe(60000);
    expect(f.dailyRate).toBe(2000);
  });
  it("mes cerrado = gasto real; mes futuro = solo lo previsto fijo", () => {
    expect(forecastMonthEnd({ monthIso: "2026-10-01", today: "2026-11-23", spentVariable: 30000, spentFixed: 80000, plannedFixed: 80000, income: 200000 }).projectedSpend).toBe(110000);
    expect(forecastMonthEnd({ monthIso: "2027-01-01", today: "2026-11-23", spentVariable: 0, spentFixed: 0, plannedFixed: 80000, income: 200000 }).projectedSpend).toBe(80000);
  });
  it("febrero bisiesto", () => { expect(daysInMonth("2028-02-01")).toBe(29); });
});

describe("bote común", () => {
  const m = [{ memberId: "a", incomeCents: 300000 }, { memberId: "b", incomeCents: 100000 }];
  it("proporcional a los ingresos", () => {
    expect(contributionTargets("proportional_to_income", 100000, m).map((x) => x.expectedCents)).toEqual([75000, 25000]);
  });
  it("proporcional sin ingresos cae a partes iguales", () => {
    expect(contributionTargets("proportional_to_income", 1000, [{ memberId: "a", incomeCents: 0 }, { memberId: "b", incomeCents: 0 }]).map((x) => x.expectedCents)).toEqual([500, 500]);
  });
  it("% fijo debe sumar 100 y el importe fijo se respeta", () => {
    expect(contributionTargets("fixed_percent", 1000, m, { a: 6000, b: 4000 }).map((x) => x.expectedCents)).toEqual([600, 400]);
    expect(() => contributionTargets("fixed_percent", 1000, m, { a: 6000, b: 3000 })).toThrow();
    expect(contributionTargets("fixed_amount", 0, m, { a: 50000, b: 20000 }).map((x) => x.expectedCents)).toEqual([50000, 20000]);
  });
  it("saldo del bote", () => {
    expect(potBalance([50000, 20000], [12000, 3000])).toBe(55000);
  });
});

import { sumByFund } from "@/lib/money";
describe("gasto por fondo", () => {
  it("agrupa por fondo y deja lo sin categoría aparte", () => {
    const m = new Map([["c1", "fijos"], ["c2", "fijos"], ["c3", "ocio"]]);
    const r = sumByFund([{ categoryId: "c1", cents: 100 }, { categoryId: "c2", cents: 50 }, { categoryId: "c3", cents: 7 }, { categoryId: null, cents: 3 }, { categoryId: "zz", cents: 1 }], m);
    expect(r.get("fijos")).toBe(150);
    expect(r.get("ocio")).toBe(7);
    expect(r.get(null)).toBe(4);
  });
});

describe("previsión realista de fin de mes", () => {
  const funds = [
    { kind: "fixed", planned: 90000, spent: 60000 }, { kind: "variable", planned: 40000, spent: 10000 },
    { kind: "leisure", planned: 25000, spent: 30000 }, { kind: "savings", planned: 30000, spent: 0 },
  ];
  it("ingresos − gastado − lo que queda previsto de fijos y variable", () => {
    const o = monthOutlook(210000, 100000, funds);
    expect(o.pendingFixed).toBe(30000);
    expect(o.pendingVariable).toBe(30000); // 40000 − 10000; el ocio ya se pasó y no resta ni suma
    expect(o.projectedLeftover).toBe(210000 - 100000 - 30000 - 30000);
  });
  it("el ahorro previsto no resta: no es un gasto", () => {
    expect(monthOutlook(100000, 0, [{ kind: "savings", planned: 50000, spent: 0 }]).projectedLeftover).toBe(100000);
  });
  it("un fondo pasado de lo previsto no añade previsión negativa", () => {
    expect(monthOutlook(100000, 20000, [{ kind: "variable", planned: 10000, spent: 20000 }]).projectedLeftover).toBe(80000);
  });
  it("con 23,45 € gastados en un plan de 2.100 € la previsión no se parece a «te sobra 2.076»", () => {
    const o = monthOutlook(210000, 2345, [{ kind: "fixed", planned: 105000, spent: 0 }, { kind: "variable", planned: 63000, spent: 2345 }, { kind: "savings", planned: 42000, spent: 0 }]);
    expect(o.projectedLeftover).toBe(210000 - 2345 - 105000 - 60655);
  });
  it("tasa de ahorro prevista = lo que va a ahorro / ingresos, no la real a mitad de mes", () => {
    expect(plannedSavingsBp(210000, funds)).toBe(1429); // 300 / 2.100 ≈ 14,29 %
    expect(plannedSavingsBp(0, funds)).toBe(0);
    expect(plannedSavingsBp(100, [{ kind: "savings", planned: 500, spent: 0 }])).toBe(10000);
  });
});
