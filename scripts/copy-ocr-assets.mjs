// Copia los archivos del OCR (worker, núcleo wasm y datos de español) a public/tesseract para servirlos desde el propio
// dominio: así el navegador no descarga código de terceros y la CSP puede seguir cerrada.
import fs from "node:fs";
import path from "node:path";

const out = "public/tesseract";
const copy = (from, to) => {
  if (!fs.existsSync(from)) return console.warn("OCR: falta", from);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
copy("node_modules/tesseract.js/dist/worker.min.js", `${out}/worker.min.js`);
for (const f of fs.existsSync("node_modules/tesseract.js-core") ? fs.readdirSync("node_modules/tesseract.js-core") : []) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(f)) copy(`node_modules/tesseract.js-core/${f}`, `${out}/core/${f}`);
}
copy("node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz", `${out}/lang/spa.traineddata.gz`);
console.log("OCR: archivos copiados a", out);
