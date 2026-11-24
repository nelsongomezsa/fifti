import { describe, expect, it } from "vitest";
import { upcomingCharges, type RecurringLite } from "@/lib/calendar";
import { ADVANCE_OPTIONS, daysBetween, fixedExpensePayload, toAdvance, usersForLead } from "@/lib/fixed-advance";
import { translatorFor } from "@/i18n/translate";

const rec = (over: Partial<RecurringLite & { spaceId: string }>): RecurringLite & { spaceId: string } =>
  ({ id: "r", description: "Alquiler", amountCents: 65000, frequency: "monthly", day: 1, nextRun: "2026-12-01", spaceId: "casa", ...over });

describe("próximos cobros", () => {
  const today = "2026-11-24";
  it("lista los cobros de los próximos 30 días por orden de fecha, de todas las burbujas", () => {
    const list = upcomingCharges([
      rec({}), rec({ id: "n", description: "Netflix", amountCents: 1399, day: 5, nextRun: "2026-12-05", spaceId: "p" }), rec({ id: "g", description: "Gimnasio", day: 28, nextRun: "2026-11-28", amountCents: 3500, spaceId: "p" }),
    ], [], today);
    expect(list.map((c) => [c.date, c.label, c.spaceId])).toEqual([["2026-11-28", "Gimnasio", "p"], ["2026-12-01", "Alquiler", "casa"], ["2026-12-05", "Netflix", "p"]]); // el 28 de diciembre queda fuera de los 30 días
  });
  it("incluye hoy y el día 30, y excluye lo anterior y lo posterior", () => {
    const y = { frequency: "yearly" as const };
    const l = upcomingCharges([rec({ ...y, id: "a", nextRun: "2026-11-24", day: 24, description: "Hoy" }), rec({ ...y, id: "b", nextRun: "2026-12-24", day: 24, description: "Día 30" }), rec({ ...y, id: "c", nextRun: "2026-12-25", day: 25, description: "Día 31" }), rec({ ...y, id: "d", nextRun: "2026-11-23", day: 23, description: "Ayer" })], [], today);
    expect(l.map((c) => c.label)).toEqual(["Hoy", "Día 30"]);
    expect(l.map((c) => c.date)).toEqual(["2026-11-24", "2026-12-24"]);
  });
  it("los semanales aparecen varias veces y el periodo puede cruzar tres meses", () => {
    const w = upcomingCharges([rec({ frequency: "weekly", nextRun: "2026-11-25", description: "Cole" })], [], today);
    expect(w).toHaveLength(5);
    const cross = upcomingCharges([rec({ nextRun: "2027-02-05", day: 5, description: "Seguro" })], [], "2027-01-31");
    expect(cross.map((c) => c.date)).toEqual(["2027-02-05"]);
  });
  it("suma metas pendientes y el total del periodo cuadra", () => {
    const l = upcomingCharges([rec({})], [{ date: "2026-12-10", label: "Viaje Lisboa", cents: 20000, spaceId: "p" }, { date: "2027-02-01", label: "Lejos", cents: 1, spaceId: "p" }], today);
    expect(l.map((c) => c.kind)).toEqual(["fijo", "meta"]);
    expect(l.reduce((a, c) => a + c.cents, 0)).toBe(85000);
  });
  it("sin cobros devuelve una lista vacía", () => {
    expect(upcomingCharges([], [], today)).toEqual([]);
  });
});

describe("antelación del aviso de gasto fijo", () => {
  it("solo admite 1, 3 o 7 días (cualquier otro valor cae a 1)", () => {
    expect([...ADVANCE_OPTIONS]).toEqual([1, 3, 7]);
    expect([1, 3, 7, 2, 0, 30, "x", null].map(toAdvance)).toEqual([1, 3, 7, 1, 1, 1, 1, 1]);
  });
  it("cuenta los días hasta el cobro", () => {
    expect(daysBetween("2026-11-24", "2026-11-27")).toBe(3);
    expect(daysBetween("2026-11-24", "2026-12-01")).toBe(7);
  });
  it("avisa a cada persona solo el día que eligió", () => {
    const prefs = [{ userId: "ana", advance: 3 }, { userId: "leo", advance: 7 }];
    const users = ["ana", "leo", "marta"]; // marta no tiene preferencias: 1 día
    expect(usersForLead(prefs, users, 1)).toEqual(["marta"]);
    expect(usersForLead(prefs, users, 3)).toEqual(["ana"]);
    expect(usersForLead(prefs, users, 7)).toEqual(["leo"]);
    expect(usersForLead(prefs, users, 2)).toEqual([]);
  });
  it("el aviso dice el nombre del gasto y cuándo vence, sin importe, en cada idioma", () => {
    const es = fixedExpensePayload("Alquiler", 3)(translatorFor("es"));
    expect(es.body).toBe("Vence «Alquiler» en 3 días.");
    expect(fixedExpensePayload("Alquiler", 1)(translatorFor("es")).body).toBe("Vence «Alquiler» mañana.");
    expect(fixedExpensePayload("Alquiler", 7)(translatorFor("en")).body).toBe("Due «Alquiler» in 7 days.");
    expect(es.body).not.toMatch(/\d+[.,]\d{2}|€/);
    expect(es.url).toBe("/calendario");
  });
  it("un nombre larguísimo se recorta", () => {
    expect(fixedExpensePayload("x".repeat(200), 1)(translatorFor("es")).body.length).toBeLessThan(90);
  });
});
