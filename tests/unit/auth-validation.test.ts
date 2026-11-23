import { describe, expect, it } from "vitest";
import { loginSchema, passwordSchema, safeNext, signUpSchema } from "@/lib/validation/auth";

describe("validación de auth", () => {
  it("exige contraseña de 12 a 128", () => {
    expect(passwordSchema.safeParse("corta").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
  it("rechaza campos extra (mass assignment)", () => {
    const base = { displayName: "Ana", email: "ana@example.test", password: "una-clave-larga-1", confirmPassword: "una-clave-larga-1" };
    expect(signUpSchema.safeParse(base).success).toBe(true);
    expect(signUpSchema.safeParse({ ...base, role: "owner" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x", admin: true }).success).toBe(false);
  });
  it("normaliza el email", () => {
    const r = loginSchema.parse({ email: "  ANA@Example.TEST ", password: "x" });
    expect(r.email).toBe("ana@example.test");
  });
  it("safeNext bloquea redirecciones abiertas", () => {
    expect(safeNext("/plan")).toBe("/plan");
    expect(safeNext("//evil.com")).toBe("/inicio");
    expect(safeNext("https://evil.com")).toBe("/inicio");
    expect(safeNext("/\\evil.com")).toBe("/inicio");
    expect(safeNext(null)).toBe("/inicio");
  });
});
