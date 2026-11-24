import { describe, expect, it } from "vitest";
import { localizePayload, type PushContent } from "@/i18n/push-content";
import { displayName } from "@/lib/system-names";

const fundAlert = (name: string, key: string | null): PushContent => (t) => ({
  title: "Fifti", body: `${t("Vas por el 80 % del fondo")} ${displayName(t, name, key)}.`, url: "/plan",
});

describe("notificaciones en el idioma del destinatario", () => {
  it("español por defecto y para perfiles sin idioma", () => {
    expect(localizePayload(fundAlert("Gastos fijos", "fund.fixed"), "es").body).toBe("Vas por el 80 % de la partida Fijos.");
    expect(localizePayload(fundAlert("Gastos fijos", "fund.fixed"), null).body).toBe("Vas por el 80 % de la partida Fijos.");
  });
  it("inglés con el nombre del fondo del sistema traducido", () => {
    expect(localizePayload(fundAlert("Gastos fijos", "fund.fixed"), "en").body).toBe("You're at 80 % of the budget line Fixed.");
  });
  it("un fondo creado por el usuario conserva su nombre en cualquier idioma", () => {
    expect(localizePayload(fundAlert("Ocio", null), "en").body).toBe("You're at 80 % of the budget line Ocio.");
    expect(localizePayload(fundAlert("Mis caprichos", null), "en").body).toBe("You're at 80 % of the budget line Mis caprichos.");
  });
  it("el título que puso el usuario (p. ej. nombre del grupo) no se traduce", () => {
    const c: PushContent = (t) => ({ title: "Viaje", body: t("Hay un gasto nuevo."), url: "/movimientos" });
    expect(localizePayload(c, "en")).toEqual({ title: "Viaje", body: "There's a new expense.", url: "/movimientos" });
  });
  it("los textos son genéricos: ninguna plantilla incluye importes", () => {
    const samples = [fundAlert("X", null), (t: (s: string) => string) => ({ title: "Fifti", body: t("Mañana vence un gasto fijo."), url: "/plan" })];
    for (const s of samples) for (const l of ["es", "en"]) expect(localizePayload(s as PushContent, l).body).not.toMatch(/[€$£]|\d+[.,]\d{2}/);
  });
});
