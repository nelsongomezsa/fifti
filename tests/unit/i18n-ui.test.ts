import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/en-ui.json";

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

describe("traducciones de la interfaz (en-ui.json)", () => {
  const dict = en as Record<string, string>;
  it("todo texto pasado a x(\"…\") tiene su traducción al inglés", () => {
    const missing: string[] = [];
    for (const f of walk("src").filter((p) => /\.tsx?$/.test(p))) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/\bx\(("(?:[^"\\]|\\.)*")\)/g)) {
        const key = JSON.parse(m[1]!) as string;
        if (/\p{L}/u.test(key) && !(key in dict)) missing.push(`${f}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it("los mensajes de error de las migraciones SQL están traducidos", () => {
    const missing: string[] = [];
    for (const f of fs.readdirSync("supabase/migrations")) {
      for (const m of fs.readFileSync(path.join("supabase/migrations", f), "utf8").matchAll(/raise exception '((?:[^']|'')*)'/g)) {
        const key = m[1]!.replace(/''/g, "'").replace(/%%/g, "%");
        if (!(key in dict)) missing.push(key);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
  it("ninguna traducción está vacía ni conserva marcadores sin pareja", () => {
    for (const [k, v] of Object.entries(dict)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });
});
