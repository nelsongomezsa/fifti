import { describe, expect, it } from "vitest";
import { nextOccurrence, occurrenceNumber, projectRecurring, upcomingCharges, type RecurringLite } from "@/lib/calendar";
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

describe("frecuencia trimestral, próximo cobro y ocurrencias saltadas", () => {
  const q = { id: "q", description: "Seguro", amountCents: 12000, frequency: "quarterly" as const, day: 5, nextRun: "2026-12-05" };
  it("el trimestral cae cada 3 meses desde el próximo cobro", () => {
    expect(projectRecurring(q, "2026-12-01")).toEqual(["2026-12-05"]);
    expect(projectRecurring(q, "2027-01-01")).toEqual([]);
    expect(projectRecurring(q, "2027-03-01")).toEqual(["2027-03-05"]);
    expect(projectRecurring(q, "2026-09-01")).toEqual([]);
  });
  it("el turno de un trimestral cuenta de 3 en 3 meses", () => {
    expect(occurrenceNumber({ frequency: "quarterly", nextRun: "2026-12-05" }, "2027-06-05")).toBe(2);
  });
  it("próximo cobro al crear un gasto fijo (hoy martes 24 nov 2026)", () => {
    expect(nextOccurrence("monthly", 5, "2026-11-24")).toBe("2026-12-05");
    expect(nextOccurrence("monthly", 24, "2026-11-24")).toBe("2026-11-24");
    expect(nextOccurrence("monthly", 31, "2026-11-24")).toBe("2026-11-30"); // noviembre no tiene 31
    expect(nextOccurrence("weekly", 5, "2026-11-24")).toBe("2026-11-27"); // viernes
    expect(nextOccurrence("weekly", 2, "2026-11-24")).toBe("2026-11-24"); // hoy es martes
    expect(nextOccurrence("quarterly", 1, "2026-11-24")).toBe("2026-12-01");
    expect(nextOccurrence("yearly", 15, "2026-11-24", 3)).toBe("2027-03-15");
    expect(nextOccurrence("yearly", 30, "2026-11-24", 11)).toBe("2026-11-30");
  });
  it("una ocurrencia saltada desaparece de los próximos cobros y solo esa", () => {
    const rec = { id: "r", description: "Gimnasio", amountCents: 3500, frequency: "monthly" as const, day: 10, nextRun: "2026-12-10", spaceId: "p" };
    const skips = new Set(["r|2026-12-10"]);
    expect(upcomingCharges([rec], [], "2026-11-24", 60, skips).map((c) => c.date)).not.toContain("2026-12-10");
    expect(upcomingCharges([rec], [], "2026-11-24", 30, skips)).toEqual([]);
    expect(upcomingCharges([rec], [], "2026-11-24", 30)).toHaveLength(1);
  });
});
