import fs from "node:fs";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync("src/app/globals.css", "utf8");
const block = (sel: string) => css.slice(css.indexOf(sel + " {"), css.indexOf("}", css.indexOf(sel + " {")));
const tokens = (b: string) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));
const dark = tokens(block(":root"));
const light = { ...dark, ...tokens(block(':root[data-theme="light"]')) };

const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe.each([["oscuro", dark], ["claro", light]] as const)("contraste AA en modo %s", (_n, t) => {
  it("texto sobre fondo y superficies: ≥ 4,5:1", () => {
    for (const bg of [t.bg!, t.surface!, t["surface-2"]!]) {
      expect(ratio(t.text!, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t["text-2"]!, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t["text-3"]!, bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t["over-text"]!, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("relleno de aviso (80 %) y de exceso (rojo) sobre la pista de la barra: ≥ 3:1", () => {
    expect(ratio(t.warn!, t.track!)).toBeGreaterThanOrEqual(3);
    expect(ratio(t.over!, t.track!)).toBeGreaterThanOrEqual(3);
  });
  it("texto de acento sobre los colores de burbuja: ≥ 4,5:1", () => {
    for (const c of [t.lime!, t.lilac!, t.tangerine!]) expect(ratio(t["on-accent"]!, c)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("tokens de aviso", () => {
  it("el ámbar del 80 % en oscuro es #F5C542 y no es la mandarina de los planes espontáneos", () => {
    expect(dark.warn!.toUpperCase()).toBe("#F5C542");
    expect(dark.tangerine!.toUpperCase()).toBe("#FF9F43");
    expect(dark.warn!.toLowerCase()).not.toBe(dark.tangerine!.toLowerCase());
    expect(dark.over!.toUpperCase()).toBe("#FF6B6B");
  });
});
