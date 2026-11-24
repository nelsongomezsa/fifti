import { describe, expect, it } from "vitest";
import { weeklyBudget } from "@/lib/weekly";

const funds = [{ kind: "fixed", planned: 90000, spent: 90000 }, { kind: "variable", planned: 40000, spent: 10000 }, { kind: "leisure", planned: 20000, spent: 2000 }, { kind: "savings", planned: 30000, spent: 0 }];

describe("presupuesto semanal", () => {
  it("reparte lo que queda del gasto variable por los días que faltan del mes", () => {
    // miércoles 11 nov 2026: quedan 20 días del mes (11..30) y 5 de la semana (mié..dom). Variable: 60000 − 12000 = 48000
    const w = weeklyBudget(funds, "2026-11-11")!;
    expect(w.daysInMonth).toBe(20);
    expect(w.daysInWeek).toBe(5);
    expect(w.leftCents).toBe(12000);
    expect(w.status).toBe("ok");
  });
  it("ignora fijos, ahorro y el resto de fondos no variables", () => {
    expect(weeklyBudget([{ kind: "fixed", planned: 1000, spent: 0 }, { kind: "savings", planned: 500, spent: 0 }], "2026-11-11")).toBeNull();
  });
  it("ámbar al 80 % y rojo al pasarse", () => {
    expect(weeklyBudget([{ kind: "variable", planned: 10000, spent: 8000 }], "2026-11-11")!.status).toBe("warn");
    const over = weeklyBudget([{ kind: "variable", planned: 10000, spent: 10500 }], "2026-11-11")!;
    expect(over.status).toBe("over");
    expect(over.leftCents).toBe(-500);
  });
  it("a fin de mes la semana no pasa de los días que quedan", () => {
    const w = weeklyBudget([{ kind: "variable", planned: 30000, spent: 0 }], "2026-11-30")!; // lunes 30: queda 1 día
    expect(w.daysInWeek).toBe(1);
    expect(w.leftCents).toBe(30000);
  });
  it("el domingo cuenta solo el propio día", () => {
    const w = weeklyBudget([{ kind: "variable", planned: 31000, spent: 0 }], "2026-11-29")!; // domingo
    expect(w.daysInWeek).toBe(2 > w.daysInMonth ? w.daysInMonth : 1);
  });
});
