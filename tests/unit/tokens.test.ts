import { describe, expect, it } from "vitest";
import { generateToken, hashToken, isValidToken } from "@/lib/security/tokens";
import { createSpaceSchema, linkSchema, parsePercentToBp, sharesSchema } from "@/lib/validation/spaces";

describe("tokens", () => {
  it("genera 32 bytes aleatorios y guarda solo el hash", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(isValidToken(a.token)).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a.token)).toBe(a.hash);
    expect(a.hash).not.toContain(a.token);
  });
  it("rechaza tokens mal formados", () => {
    expect(isValidToken("corto")).toBe(false);
    expect(isValidToken("a".repeat(43) + "!")).toBe(false);
    expect(isValidToken("'; drop table x;--" + "a".repeat(30))).toBe(false);
  });
});

describe("validación de espacios", () => {
  it("acepta un grupo válido y rechaza campos extra", () => {
    const ok = { name: "Viaje Lisboa", kind: "group", currency: "eur" };
    expect(createSpaceSchema.parse(ok).currency).toBe("EUR");
    expect(createSpaceSchema.safeParse({ ...ok, kind: "personal" }).success).toBe(false);
    expect(createSpaceSchema.safeParse({ ...ok, created_by: "x" }).success).toBe(false);
    expect(createSpaceSchema.safeParse({ ...ok, startsOn: "2026-05-10", endsOn: "2026-05-01" }).success).toBe(false);
  });
  it("limita días y usos del enlace", () => {
    const base = { spaceId: crypto.randomUUID(), kind: "guest", days: 7, maxUses: 10 };
    expect(linkSchema.safeParse(base).success).toBe(true);
    expect(linkSchema.safeParse({ ...base, days: 365 }).success).toBe(false);
    expect(linkSchema.safeParse({ ...base, maxUses: 0 }).success).toBe(false);
  });
  it("parsea porcentajes a puntos básicos", () => {
    expect(parsePercentToBp("33,34")).toBe(3334);
    expect(parsePercentToBp("100")).toBe(10000);
    expect(parsePercentToBp("101")).toBeNull();
    expect(parsePercentToBp("-5")).toBeNull();
    expect(parsePercentToBp("x")).toBeNull();
  });
  it("los porcentajes deben sumar 100", () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect(sharesSchema.safeParse([{ member_id: a, bp: 6000 }, { member_id: b, bp: 4000 }]).success).toBe(true);
    expect(sharesSchema.safeParse([{ member_id: a, bp: 6000 }, { member_id: b, bp: 3999 }]).success).toBe(false);
  });
});
