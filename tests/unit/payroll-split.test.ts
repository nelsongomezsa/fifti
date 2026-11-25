import { describe, expect, it } from "vitest";
import { payrollSource, payrollSplit } from "@/lib/payroll-split";

describe("reparte tu nómina", () => {
  const funds = [
    { plannedCents: 63000, accountId: "revolut" }, { plannedCents: 42000, accountId: "ing" },
    { plannedCents: 30000, accountId: "comun" }, { plannedCents: 90000, accountId: "nomina" }, { plannedCents: 5000, accountId: null },
  ];
  it("suma lo previsto por cuenta destino y no traspasa a la propia cuenta de nómina ni a partidas sin cuenta", () => {
    expect(payrollSplit(funds, "nomina", [])).toEqual([
      { toAccountId: "revolut", amountCents: 63000 }, { toAccountId: "ing", amountCents: 42000 }, { toAccountId: "comun", amountCents: 30000 },
    ]);
  });
  it("agrupa varias partidas en la misma cuenta", () => {
    expect(payrollSplit([{ plannedCents: 100, accountId: "r" }, { plannedCents: 250, accountId: "r" }], "n", [])).toEqual([{ toAccountId: "r", amountCents: 350 }]);
  });
  it("descuenta los traspasos ya hechos y desaparece lo completado", () => {
    expect(payrollSplit(funds, "nomina", [{ toAccount: "revolut", amountCents: 63000 }, { toAccount: "ing", amountCents: 12000 }])).toEqual([
      { toAccountId: "ing", amountCents: 30000 }, { toAccountId: "comun", amountCents: 30000 },
    ]);
  });
  it("sin cuenta de origen no sugiere nada", () => { expect(payrollSplit(funds, null, [])).toEqual([]); });
  it("la cuenta de origen es la del ingreso, o la de nómina, o la de por defecto", () => {
    const acc = [{ id: "a", kind: "daily", isDefault: true, mine: true }, { id: "b", kind: "payroll", isDefault: false, mine: true }, { id: "c", kind: "shared", isDefault: false, mine: false }];
    expect(payrollSource("a", acc)).toBe("a");
    expect(payrollSource(null, acc)).toBe("b");
    expect(payrollSource("c", acc)).toBe("b"); // la común no es suya
    expect(payrollSource(null, [{ id: "a", kind: "daily", isDefault: true, mine: true }])).toBe("a");
  });
});
