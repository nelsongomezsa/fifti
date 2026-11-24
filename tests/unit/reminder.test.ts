import { describe, expect, it } from "vitest";
import { localParts, shouldRemind } from "@/lib/reminder";

const pref = { reminderHour: 21, timezone: "Europe/Madrid" };

describe("recordatorio diario", () => {
  it("calcula la hora y el día locales de cada zona", () => {
    const t = new Date("2026-11-24T20:30:00Z"); // 21:30 en Madrid (CET), 15:30 en Nueva York
    expect(localParts(t, "Europe/Madrid")).toEqual({ hour: 21, ymd: "2026-11-24" });
    expect(localParts(t, "America/New_York")).toEqual({ hour: 15, ymd: "2026-11-24" });
    expect(localParts(new Date("2026-11-24T23:30:00Z"), "Europe/Madrid")).toEqual({ hour: 0, ymd: "2026-11-25" });
  });
  it("cambia con el horario de verano", () => {
    expect(localParts(new Date("2026-07-24T19:30:00Z"), "Europe/Madrid")?.hour).toBe(21); // CEST = UTC+2
  });
  it("avisa a su hora si hoy no ha apuntado nada", () => {
    expect(shouldRemind(pref, new Date("2026-11-24T20:05:00Z"), [])).toEqual({ remind: true, ymd: "2026-11-24" });
  });
  it("no avisa fuera de su hora", () => {
    expect(shouldRemind(pref, new Date("2026-11-24T18:05:00Z"), [])?.remind).toBe(false);
  });
  it("no avisa si ese día ya ha apuntado algo (en su día local)", () => {
    const now = new Date("2026-11-24T20:05:00Z");
    expect(shouldRemind(pref, now, [new Date("2026-11-24T09:00:00Z")])?.remind).toBe(false);
    // un gasto de anoche (día local anterior) no cuenta
    expect(shouldRemind(pref, now, [new Date("2026-11-23T22:30:00Z")])?.remind).toBe(true);
  });
  it("una zona horaria inválida no avisa y no rompe", () => {
    expect(shouldRemind({ reminderHour: 21, timezone: "No/Existe" }, new Date(), [])).toBeNull();
  });
});
