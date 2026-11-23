import { describe, expect, it } from "vitest";
import { hashPin, lockoutSeconds, PIN_RE, verifyPin } from "@/lib/applock";

describe("bloqueo de la app", () => {
  it("valida el formato del PIN", () => {
    for (const ok of ["1234", "123456"]) expect(PIN_RE.test(ok)).toBe(true);
    for (const bad of ["123", "1234567", "12a4", "", " 1234"]) expect(PIN_RE.test(bad)).toBe(false);
  });
  it("guarda solo un hash con sal y lo verifica", async () => {
    const h = await hashPin("4821");
    expect(JSON.stringify(h)).not.toContain("4821");
    expect(await verifyPin("4821", h)).toBe(true);
    expect(await verifyPin("4822", h)).toBe(false);
    expect(await verifyPin("abc", h)).toBe(false);
  });
  it("la sal hace distintos los hashes del mismo PIN", async () => {
    const a = await hashPin("1111"), b = await hashPin("1111");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
  it("rechaza PIN inválidos al crearlo", async () => {
    await expect(hashPin("12")).rejects.toThrow();
  });
  it("espera creciente tras fallos, con tope", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(lockoutSeconds)).toEqual([0, 0, 0, 2, 4, 8, 300]);
  });
});
