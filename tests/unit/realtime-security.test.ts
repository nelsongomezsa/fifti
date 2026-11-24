import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("excepción de Realtime (SECURITY.md)", () => {
  const action = read("src/server/actions/shopping.ts");
  const client = read("src/components/shopping/ShoppingList.tsx");
  const next = read("next.config.ts");

  it("la acción nunca devuelve el refresh_token", () => {
    const body = action.slice(action.indexOf("export async function realtimeAccess"));
    expect(body).not.toMatch(/refresh_token|refreshToken/);
    expect(body).toMatch(/access_token/);
  });
  it("el token solo vive en memoria", () => {
    expect(client).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(client).toMatch(/persistSession: false/);
    expect(client).toMatch(/autoRefreshToken: false/);
  });
  it("se pide de nuevo antes de caducar", () => {
    expect(client).toMatch(/expiresAt/);
    expect(client).toMatch(/setTimeout\(\(\) => void connect\(\)/);
  });
  it("la CSP solo permite el WebSocket del proyecto de Supabase (sin comodines en producción)", () => {
    expect(next).toMatch(/supabaseWs = supabaseUrl\.replace\(/);
    expect(next).toMatch(/connect-src[^\n]*\$\{supabaseWs\}/);
    const connect = next.split("\n").find((l) => l.includes("connect-src"))!;
    expect(connect).not.toMatch(/wss:\s|wss:\*|\*\.supabase/);
    expect(connect).toMatch(/isDev \? " ws: http:\/\/127\.0\.0\.1:54321"/); // el ws: genérico solo en desarrollo
  });
});
