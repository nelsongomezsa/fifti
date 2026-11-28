import { describe, expect, it } from "vitest";
import { nextOccurrence, occurrenceNumber } from "@/lib/calendar";
import { isoWeekday, monthIncome, pendingPaydays, type IncomeRule, type PayFrequency } from "@/lib/paydays";

const rule = (frequency: PayFrequency, nextRun: string, extra: Partial<IncomeRule> = {}): IncomeRule => ({
  id: "r", memberId: "ana", source: "Cafetería", amountCents: 65000, currency: "AUD", accountId: null,
  frequency, day: Number(nextRun.slice(8)), nextRun, active: true, ...extra,
});
const months = (r: IncomeRule, list: string[]) => list.map((m) => pendingPaydays(r, m).length);

describe("cuántos cobros caen en cada mes", () => {
  it("semanal: 4 o 5 según el mes, también en febrero", () => {
    // viernes desde el 1 de enero de 2027
    expect(months(rule("weekly", "2027-01-01"), ["2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01"])).toEqual([5, 4, 4, 5]);
    // febrero bisiesto con 5 martes
    expect(pendingPaydays(rule("weekly", "2028-02-01"), "2028-02-01")).toEqual(["2028-02-01", "2028-02-08", "2028-02-15", "2028-02-22", "2028-02-29"]);
  });
  it("cada dos semanas: 2 o 3", () => {
    expect(months(rule("biweekly", "2027-01-01"), ["2027-01-01", "2027-02-01", "2027-04-01", "2027-07-01"])).toEqual([3, 2, 2, 3]);
  });
  it("dos veces al mes: siempre dos, y los días que el mes no tiene pasan al último", () => {
    const r = rule("semimonthly", "2027-01-01", { day: 1, day2: 15 });
    expect(months(r, ["2027-01-01", "2027-02-01", "2027-04-01", "2027-07-01"])).toEqual([2, 2, 2, 2]);
    expect(pendingPaydays(r, "2027-02-01")).toEqual(["2027-02-01", "2027-02-15"]);
    const late = rule("semimonthly", "2027-01-15", { day: 15, day2: 31 });
    expect(["2027-02-01", "2027-04-01", "2028-02-01"].map((m) => pendingPaydays(late, m))).toEqual([
      ["2027-02-15", "2027-02-28"], ["2027-04-15", "2027-04-30"], ["2028-02-15", "2028-02-29"],
    ]);
    // el día 27 con el 30: ni en febrero se juntan
    expect(pendingPaydays(rule("semimonthly", "2027-01-27", { day: 27, day2: 30 }), "2027-02-01")).toEqual(["2027-02-27", "2027-02-28"]);
    // a mitad de mes solo queda el segundo
    expect(pendingPaydays(rule("semimonthly", "2027-01-15", { day: 1, day2: 15 }), "2027-01-01")).toEqual(["2027-01-15"]);
  });
  it("dos veces al mes: la próxima fecha y el número de cada una", () => {
    expect(["2027-01-01", "2027-01-02", "2027-01-16"].map((t) => nextOccurrence("semimonthly", 1, t, undefined, 15))).toEqual(["2027-01-01", "2027-01-15", "2027-02-01"]);
    expect(nextOccurrence("semimonthly", 15, "2027-02-16", undefined, 31)).toBe("2027-02-28");
    const r = { frequency: "semimonthly" as const, nextRun: "2027-01-15", day: 15, day2: 31 };
    expect(["2027-01-15", "2027-01-31", "2027-02-15", "2027-02-28", "2027-03-15"].map((d) => occurrenceNumber(r, d))).toEqual([0, 1, 2, 3, 4]);
  });
  it("mensual el 31: los meses cortos usan el último día; anual solo en su mes", () => {
    const r = rule("monthly", "2027-01-31", { day: 31 });
    expect(["2027-02-01", "2027-04-01", "2028-02-01"].map((m) => pendingPaydays(r, m)[0])).toEqual(["2027-02-28", "2027-04-30", "2028-02-29"]);
    expect(months(rule("yearly", "2027-03-10"), ["2027-02-01", "2027-03-01", "2028-03-01"])).toEqual([0, 1, 1]);
  });
  it("los cambios de hora no mueven el día de la semana", () => {
    // en Australia el reloj cambia el 4 de abril y el 3 de octubre de 2027
    for (const start of ["2027-03-26", "2027-09-24"]) {
      const dates = [`${start.slice(0, 7)}-01`, start.startsWith("2027-03") ? "2027-04-01" : "2027-10-01"].flatMap((m) => pendingPaydays(rule("weekly", start), m));
      expect(new Set(dates.map(isoWeekday))).toEqual(new Set([5]));
      expect(new Set(dates).size).toBe(dates.length);
    }
  });
  it("no cuenta lo anterior al próximo cobro, lo saltado ni las reglas en pausa", () => {
    expect(pendingPaydays(rule("weekly", "2027-01-15"), "2027-01-01")).toHaveLength(3);
    expect(pendingPaydays(rule("weekly", "2027-01-01"), "2027-01-01", new Set(["r|2027-01-08"]))).toHaveLength(4);
    expect(pendingPaydays(rule("weekly", "2027-01-01", { active: false }), "2027-01-01")).toEqual([]);
  });
  it("«cada dos semanas» elige el próximo día de la semana pedido", () => {
    expect(nextOccurrence("biweekly", 5, "2026-11-28")).toBe("2026-12-04");
  });
});

describe("ingreso del mes para repartir", () => {
  it("sin cobros que se repiten, como siempre: lo real y, si no hay, lo previsto", () => {
    expect(monthIncome(["ana"], {}, { ana: 1000 }, {}, new Set())).toBe(1000);
    expect(monthIncome(["ana"], { ana: 200 }, { ana: 1000 }, {}, new Set())).toBe(200);
  });
  it("con ellos, cobrado más pendiente; las demás personas, lo real o lo previsto", () => {
    expect(monthIncome(["ana", "leo"], { ana: 1300 }, { ana: 9999, leo: 500 }, { ana: 1950 }, new Set(["ana"]))).toBe(3750);
  });
});
