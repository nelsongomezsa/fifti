import fs from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../../messages/en-ui.json";
import { displayName, SYSTEM_NAMES } from "@/lib/system-names";

const dict = en as Record<string, string>;
const tx = (l: "es" | "en") => (s: string) => (l === "en" ? (dict[s] ?? s) : s);

describe("nombres de fondos y categorías del sistema", () => {
  it("los del sistema se traducen según el idioma", () => {
    expect(displayName(tx("es"), "Gastos fijos", "fund.fixed")).toBe("Gastos fijos");
    expect(displayName(tx("en"), "Gastos fijos", "fund.fixed")).toBe("Fixed expenses");
    expect(displayName(tx("en"), "Supermercado", "cat.groceries")).toBe("Groceries");
  });
  it("los que crea el usuario (sin clave) conservan su nombre en cualquier idioma", () => {
    expect(displayName(tx("en"), "Gastos fijos", null)).toBe("Gastos fijos"); // aunque coincida con uno del sistema
    expect(displayName(tx("en"), "Mi caja de viaje", undefined)).toBe("Mi caja de viaje");
  });
  it("una clave desconocida cae al nombre guardado", () => {
    expect(displayName(tx("en"), "Algo", "cat.no_existe")).toBe("Algo");
  });
  it("todas las claves del sistema tienen traducción al inglés", () => {
    for (const [k, es] of Object.entries(SYSTEM_NAMES)) expect(dict[es], k).toBeTruthy();
  });
  it("las claves que siembra la migración existen en SYSTEM_NAMES (y al revés)", () => {
    const sql = fs.readFileSync("supabase/migrations/20261123000014_system_keys.sql", "utf8");
    const used = new Set([...sql.matchAll(/'((?:fund|cat)\.[a-z_]+)'/g)].map((m) => m[1]!));
    for (const k of used) expect(SYSTEM_NAMES, k).toHaveProperty(k);
    for (const k of Object.keys(SYSTEM_NAMES)) expect(used.has(k), k).toBe(true);
  });
});
