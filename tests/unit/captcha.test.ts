import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const form = (token?: string) => { const fd = new FormData(); if (token !== undefined) fd.set("cf-turnstile-response", token); return fd; };

describe("captcha: token de Turnstile hacia Supabase Auth", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("con clave de sitio, falta el token si el formulario no lo trae o viene vacío o enorme", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    const { captchaFrom } = await import("@/lib/security/captcha");
    expect(captchaFrom(form()).missing).toBe(true);
    expect(captchaFrom(form("")).missing).toBe(true);
    expect(captchaFrom(form("a".repeat(3000))).missing).toBe(true);
  });
  it("con token, lo devuelve tal cual para pasarlo como captchaToken", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    const { captchaFrom } = await import("@/lib/security/captcha");
    expect(captchaFrom(form("tok-123"))).toEqual({ token: "tok-123", missing: false });
  });
  it("sin clave de sitio (desarrollo) no se exige token", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const { captchaFrom } = await import("@/lib/security/captcha");
    expect(captchaFrom(form()).missing).toBe(false);
  });
});

describe("todas las llamadas a Supabase Auth del cliente anónimo llevan captchaToken", () => {
  it("signUp, signInWithPassword, resetPasswordForEmail y signInAnonymously pasan el token", async () => {
    const { readFileSync } = await import("node:fs");
    const auth = readFileSync("src/server/actions/auth.ts", "utf8");
    const join = readFileSync("src/server/actions/join.ts", "utf8");
    const prefs = readFileSync("src/server/actions/prefs.ts", "utf8");
    for (const call of ["auth.signUp(", "auth.signInWithPassword(", "auth.resetPasswordForEmail("]) {
      const at = [...auth.matchAll(new RegExp(call.replace(/[().]/g, "\\$&"), "g"))];
      expect(at.length).toBeGreaterThan(0);
      for (const m of at) expect(auth.slice(m.index!, m.index! + 400)).toContain("captchaToken");
    }
    expect(join.slice(join.indexOf("auth.signInAnonymously("), join.indexOf("auth.signInAnonymously(") + 120)).toContain("captchaToken");
    expect(prefs.slice(prefs.indexOf("auth.signInWithPassword("), prefs.indexOf("auth.signInWithPassword(") + 200)).toContain("captchaToken");
  });
});
