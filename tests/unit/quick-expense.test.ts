import { describe, expect, it } from "vitest";
import { parseQuickExpense } from "@/lib/validation/quick-expense";

describe("parseQuickExpense", () => {
  it("lee importe con coma o punto, concepto y burbuja", () => {
    expect(parseQuickExpense({ importe: "12,50", concepto: "Café", burbuja: "personal" })).toEqual({ amountCents: 1250, description: "Café", bubble: "personal" });
    expect(parseQuickExpense({ importe: "7.5" }).amountCents).toBe(750);
  });
  it("descarta valores no válidos y claves desconocidas", () => {
    expect(parseQuickExpense({ importe: "-3" })).toEqual({});
    expect(parseQuickExpense({ importe: "abc", burbuja: "<script>" })).toEqual({});
    expect(parseQuickExpense({ x: "1" } as never)).toEqual({});
    expect(parseQuickExpense({ concepto: "a".repeat(200) })).toEqual({});
  });
});
