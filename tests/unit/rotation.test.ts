import { describe, expect, it } from "vitest";
import { occurrenceNumber, projectRecurring, rotationPayer } from "@/lib/calendar";

describe("turnos de gastos fijos", () => {
  const r = { id: "r", description: "Limpieza", amountCents: 6000, frequency: "monthly" as const, day: 5, nextRun: "2026-12-05" };
  it("el número de cobro cuenta desde el próximo", () => {
    expect(occurrenceNumber(r, "2026-12-05")).toBe(0);
    expect(occurrenceNumber(r, "2027-02-05")).toBe(2);
    expect(occurrenceNumber({ frequency: "weekly", nextRun: "2026-12-01" }, "2026-12-15")).toBe(2);
    expect(occurrenceNumber({ frequency: "yearly", nextRun: "2026-12-01" }, "2028-12-01")).toBe(2);
  });
  it("rota por orden y vuelve al primero", () => {
    const rot = ["ana", "leo", "marta"];
    expect([0, 1, 2, 3, 4].map((n) => rotationPayer(rot, 0, n))).toEqual(["ana", "leo", "marta", "ana", "leo"]);
    expect(rotationPayer(rot, 2, 0)).toBe("marta"); // la posición guardada continúa donde se quedó
  });
  it("sin turnos (o con uno solo) no hay pagador de turno", () => {
    expect(rotationPayer([], 0, 0)).toBeNull();
    expect(rotationPayer(["ana"], 0, 3)).toBeNull();
  });
  it("a quién le toca el mes que viene, según el calendario", () => {
    const fechas = projectRecurring(r, "2027-01-01");
    expect(fechas).toEqual(["2027-01-05"]);
    expect(rotationPayer(["ana", "leo"], 0, occurrenceNumber(r, fechas[0]!))).toBe("leo");
  });
});
