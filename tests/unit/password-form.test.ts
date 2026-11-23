import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changePasswordSchema, MISMATCH, passwordRequirements, resetSchema, signUpSchema, upgradeGuestSchema } from "@/lib/validation/auth";

vi.mock("server-only", () => ({}));

const good = "una-clave-larga-1";
const issue = (r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) => r.error?.issues[0];

describe("repetir contraseña: validación en el servidor (Zod)", () => {
  it("registro: si no coinciden, 'Las contraseñas no coinciden' en confirmPassword", () => {
    const r = signUpSchema.safeParse({ displayName: "Ana", email: "ana@example.test", password: good, confirmPassword: good + "x" });
    expect(r.success).toBe(false);
    expect(issue(r)).toMatchObject({ message: MISMATCH, path: ["confirmPassword"] });
    expect(MISMATCH).toBe("Las contraseñas no coinciden");
  });
  it("registro: coinciden → válido; faltan campos o sobran → rechazado (strict)", () => {
    const ok = { displayName: "Ana", email: "ana@example.test", password: good, confirmPassword: good };
    expect(signUpSchema.safeParse(ok).success).toBe(true);
    expect(signUpSchema.safeParse({ ...ok, confirmPassword: undefined }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...ok, role: "admin" }).success).toBe(false);
  });
  it("restablecer, cambiar y crear cuenta de invitado exigen lo mismo", () => {
    expect(issue(resetSchema.safeParse({ password: good, confirmPassword: "otra-distinta-1" }))?.message).toBe(MISMATCH);
    expect(resetSchema.safeParse({ password: good, confirmPassword: good }).success).toBe(true);
    expect(issue(changePasswordSchema.safeParse({ currentPassword: "vieja", password: good, confirmPassword: "no" }))?.message).toBe(MISMATCH);
    expect(changePasswordSchema.safeParse({ currentPassword: "", password: good, confirmPassword: good }).success).toBe(false);
    expect(upgradeGuestSchema.safeParse({ email: "marta@example.test", password: good, confirmPassword: good }).success).toBe(true);
    expect(issue(upgradeGuestSchema.safeParse({ email: "marta@example.test", password: good, confirmPassword: "x" }))?.message).toBe(MISMATCH);
  });
  it("sigue exigiendo 12 caracteres (mensaje de longitud antes que el de coincidencia)", () => {
    const r = resetSchema.safeParse({ password: "corta", confirmPassword: "corta" });
    expect(r.success).toBe(false);
    expect(issue(r)?.message).toBe("Usa al menos 12 caracteres");
  });
});

describe("requisitos en directo (misma regla que el servidor)", () => {
  it("12 caracteres y coincidencia", () => {
    expect(passwordRequirements("", "")).toEqual({ minLength: false, match: false, all: false });
    expect(passwordRequirements("11-caracter", "11-caracter")).toMatchObject({ minLength: false, match: true, all: false });
    expect(passwordRequirements(good, "")).toMatchObject({ minLength: true, match: false, all: false });
    expect(passwordRequirements(good, good + "!")).toMatchObject({ minLength: true, match: false, all: false });
    expect(passwordRequirements(good, good)).toEqual({ minLength: true, match: true, all: true });
    expect(passwordRequirements("a".repeat(129), "a".repeat(129)).all).toBe(false);
  });
});

describe("HIBP por k-anonymity", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("solo envía los 5 primeros caracteres del SHA-1 y detecta si aparece", async () => {
    const { pwnedCount } = await import("@/lib/security/hibp");
    const sha = createHash("sha1").update("password123456", "utf8").digest("hex").toUpperCase();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(`0000000000000000000000000000000000A:3\n${sha.slice(5)}:48213\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:9`, { status: 200 });
    });
    expect(await pwnedCount("password123456")).toBe(48213);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`);
    expect(calls[0]).not.toContain(sha.slice(5)); // el resto del hash y la contraseña nunca salen
    expect(calls[0]!.split("/range/")[1]).toBe(sha.slice(0, 5)); // solo el prefijo de 5 caracteres, nada más
  });
  it("0 si no aparece; null si el servicio falla (no bloquea el registro)", async () => {
    const { pwnedCount } = await import("@/lib/security/hibp");
    vi.stubGlobal("fetch", async () => new Response("ABCDE12345ABCDE12345ABCDE12345ABCDE:1", { status: 200 }));
    expect(await pwnedCount("una-clave-unica-y-larga-9")).toBe(0);
    vi.stubGlobal("fetch", async () => { throw new Error("red"); });
    expect(await pwnedCount("otra-clave-larga-9")).toBeNull();
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    expect(await pwnedCount("otra-clave-larga-9")).toBeNull();
  });
});
