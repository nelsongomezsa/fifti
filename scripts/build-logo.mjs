// Genera los trazados SVG del logotipo "fifti" a partir de Space Grotesk Bold.
// Uso: node scripts/build-logo.mjs  → escribe src/components/brand/logo-data.ts y public/brand/*.svg
import opentype from "opentype.js";
import fs from "node:fs";

const dir = "node_modules/@fontsource/space-grotesk/files/";
const load = (f) => {
  const b = fs.readFileSync(dir + f);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const latin = load("space-grotesk-latin-700-normal.woff");
const ext = load("space-grotesk-latin-ext-700-normal.woff");

const upm = latin.unitsPerEm;
const size = 100; // 1 unidad = 1/100 em·100
const scale = size / upm;
const tracking = -0.05 * size;

const glyphFor = (ch) => {
  for (const f of [latin, ext]) {
    const g = f.charToGlyph(ch);
    if (g && g.index !== 0) return { g, font: f };
  }
  throw new Error("glifo no encontrado: " + ch);
};

const text = ["f", "ı", "f", "t", "ı"];
let x = 0;
const parts = [];
const stems = [];
const kernAfter = { f: 3.2 }; // evita que los travesaños de f y t se toquen
for (const [idx, ch] of text.entries()) {
  const { g } = glyphFor(ch);
  const p = g.getPath(x, 0, size);
  parts.push(p.toPathData(2));
  const bb = p.getBoundingBox();
  if (ch === "ı") stems.push({ cx: (bb.x1 + bb.x2) / 2, top: bb.y1, w: bb.x2 - bb.x1 });
  x += g.advanceWidth * scale + tracking + (ch === "f" && text[idx + 1] === "t" ? kernAfter.f : 0);
}
const totalW = x - tracking;

// Altura de ascendente (para el viewBox) y dibujo de los puntos
const fBox = glyphFor("f").g.getPath(0, 0, size).getBoundingBox();
const topY = Math.min(fBox.y1, ...stems.map((s) => s.top)) - 0; // y negativo hacia arriba
const dotR = stems[0].w * 0.62;
const dotCy = stems[0].top - dotR * 1.25;
const minY = Math.min(topY, dotCy - dotR) - 2;
const maxY = 4; // pequeño margen bajo la línea base

const dots = stems.map((s, i) => ({ cx: +s.cx.toFixed(2), cy: +dotCy.toFixed(2), r: +dotR.toFixed(2), filled: i === 0 }));
const stroke = +(dotR * 0.34).toFixed(2);
const vb = { x: -2, y: +minY.toFixed(2), w: +(totalW + 4).toFixed(2), h: +(maxY - minY).toFixed(2) };

const ts = `// Archivo generado por scripts/build-logo.mjs. No editar a mano.
export const LOGO_PATH = ${JSON.stringify(parts.join(" "))};
export const LOGO_VIEWBOX = ${JSON.stringify(`${vb.x} ${vb.y} ${vb.w} ${vb.h}`)};
export const LOGO_DOTS = ${JSON.stringify(dots)} as const;
export const LOGO_DOT_STROKE = ${stroke};
`;
fs.mkdirSync("src/components/brand", { recursive: true });
fs.writeFileSync("src/components/brand/logo-data.ts", ts);

const svg = (fg, accent) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" role="img" aria-label="fifti"><path fill="${fg}" d="${parts.join(" ")}"/>${dots
  .map((d) => d.filled
    ? `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${accent}"/>`
    : `<circle cx="${d.cx}" cy="${d.cy}" r="${+(d.r - stroke / 2).toFixed(2)}" fill="none" stroke="${accent}" stroke-width="${stroke}"/>`)
  .join("")}</svg>`;
fs.mkdirSync("public/brand", { recursive: true });
fs.writeFileSync("public/brand/logo-dark.svg", svg("#F2F4F7", "#C6F432"));
fs.writeFileSync("public/brand/logo-light.svg", svg("#0B0D10", "#0B0D10"));

// Icono de la app: solo los dos puntos (relleno + borde) sobre #15181D, y variante "f"
const fPath = glyphFor("f").g.getPath(0, 0, size);
const fb = fPath.getBoundingBox();
fs.writeFileSync("scripts/.logo-meta.json", JSON.stringify({ fPath: fPath.toPathData(2), fb, stroke }));
console.log("ok", vb, dots);
