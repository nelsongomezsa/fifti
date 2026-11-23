import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const ok = (success: boolean) => (async () => new Response(JSON.stringify({ success }), { status: 200 })) as unknown as typeof fetch;

describe("Turnstile en el servidor", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("acepta solo si Cloudflare confirma", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secreto-de-prueba");
    const { verifyTurnstile } = await import("@/lib/security/turnstile");
    expect(await verifyTurnstile("tok", "1.2.3.4", ok(true))).toBe(true);
    expect(await verifyTurnstile("tok", "1.2.3.4", ok(false))).toBe(false);
  });
  it("sin token, token enorme o error de red: deniega", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secreto-de-prueba");
    const { verifyTurnstile } = await import("@/lib/security/turnstile");
    expect(await verifyTurnstile(undefined, "x", ok(true))).toBe(false);
    expect(await verifyTurnstile("a".repeat(3000), "x", ok(true))).toBe(false);
    expect(await verifyTurnstile("tok", "x", (async () => { throw new Error("red"); }) as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstile("tok", "x", (async () => new Response("", { status: 500 })) as unknown as typeof fetch)).toBe(false);
  });
  it("sin clave secreta: falla cerrado en producción y permite en desarrollo", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const { verifyTurnstile } = await import("@/lib/security/turnstile");
    vi.stubEnv("NODE_ENV", "production");
    expect(await verifyTurnstile("tok")).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(await verifyTurnstile("tok")).toBe(true);
  });
});
