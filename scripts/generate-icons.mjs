// Genera iconos de la PWA y favicons. Requiere haber ejecutado build-logo.mjs.
import sharp from "sharp";
import fs from "node:fs";

const { fPath, fb } = JSON.parse(fs.readFileSync("scripts/.logo-meta.json", "utf8"));
const LIME = "#C6F432", SURF = "#15181D", INK = "#0B0D10";

const dotsSvg = (size, scale) => {
  const r = size * 0.115 * scale;
  const gap = size * 0.17 * scale;
  const cx = size / 2, cy = size / 2;
  const stroke = r * 0.42;
  return `<circle cx="${cx - gap}" cy="${cy}" r="${r}" fill="${LIME}"/>` +
         `<circle cx="${cx + gap}" cy="${cy}" r="${r - stroke / 2}" fill="none" stroke="${LIME}" stroke-width="${stroke}"/>`;
};
const iconSvg = (size, { radius, scale }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
  `<rect width="${size}" height="${size}" rx="${radius}" fill="${SURF}"/>${dotsSvg(size, scale)}</svg>`;

const fSvg = (size, radius) => {
  const w = fb.x2 - fb.x1, h = fb.y2 - fb.y1;
  const k = (size * 0.62) / h;
  const tx = (size - w * k) / 2 - fb.x1 * k;
  const ty = (size - h * k) / 2 - fb.y1 * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${LIME}"/>` +
    `<path transform="translate(${tx} ${ty}) scale(${k})" fill="${INK}" d="${fPath}"/></svg>`;
};

const out = (name, svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/${name}`);

fs.mkdirSync("public/icons", { recursive: true });
fs.writeFileSync("public/icons/icon.svg", iconSvg(512, { radius: 112, scale: 1 }));
fs.writeFileSync("public/icon.svg", fSvg(64, 14)); // favicon vectorial (variante "f")
await Promise.all([
  out("icons/icon-192.png", iconSvg(512, { radius: 112, scale: 1 }), 192),
  out("icons/icon-512.png", iconSvg(512, { radius: 112, scale: 1 }), 512),
  // maskable: fondo a sangre, contenido dentro de la zona segura (80 %)
  out("icons/maskable-512.png", iconSvg(512, { radius: 0, scale: 0.78 }), 512),
  out("apple-touch-icon.png", iconSvg(512, { radius: 0, scale: 0.9 }), 180),
  out("favicon-32.png", fSvg(256, 56), 32),
  out("favicon-16.png", fSvg(256, 56), 16),
]);
// favicon.ico (PNG 32 empaquetado en ICO)
const png = fs.readFileSync("public/favicon-32.png");
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync("public/favicon.ico", Buffer.concat([head, png]));
// vista previa del logotipo para revisión visual (no se publica)
await sharp("public/brand/logo-dark.svg", { density: 300 }).flatten({ background: SURF }).resize({ width: 900 }).png().toFile("scripts/.logo-preview.png");
console.log("iconos generados");
