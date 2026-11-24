import { describe, expect, it } from "vitest";
import { matchRule, normText, type CategoryRule } from "@/lib/rules/match";

const r = (id: string, matchText: string, matchType: CategoryRule["matchType"], priority = 100, categoryId = id): CategoryRule => ({ id, matchText, matchType, categoryId, priority });

describe("reglas de categoría", () => {
  it("ignora mayúsculas, acentos y espacios", () => {
    expect(normText("  CAFÉ   Müller ")).toBe("cafe muller");
    expect(matchRule([r("a", "cafe", "contains")], "Mi  CAFÉ de la mañana")?.id).toBe("a");
  });
  it("tipos: contains, starts_with, exact", () => {
    const rules = [r("s", "merca", "starts_with"), r("e", "luz", "exact")];
    expect(matchRule(rules, "Mercadona")?.id).toBe("s");
    expect(matchRule(rules, "Compra Mercadona")).toBeNull();
    expect(matchRule(rules, "Luz")?.id).toBe("e");
    expect(matchRule(rules, "Luz del piso")).toBeNull();
  });
  it("gana la prioridad más baja", () => {
    const rules = [r("late", "super", "contains", 50), r("early", "super", "contains", 10)];
    expect(matchRule(rules, "Supermercado")?.id).toBe("early");
  });
  it("a igual prioridad gana la más específica y luego la más larga", () => {
    expect(matchRule([r("c", "mercadona", "contains"), r("x", "mercadona", "exact")], "Mercadona")?.id).toBe("x");
    expect(matchRule([r("short", "mer", "contains"), r("long", "mercadona", "contains")], "Mercadona")?.id).toBe("long");
  });
  it("sin coincidencia o texto vacío no devuelve nada", () => {
    expect(matchRule([r("a", "zara", "contains")], "Mercadona")).toBeNull();
    expect(matchRule([r("a", "zara", "contains")], "")).toBeNull();
  });
});
