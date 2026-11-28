// Comprueba que la app compilada arranca y responde sin los paquetes que outputFileTracingExcludes deja fuera
// del paquete de cada función en Vercel (lista en scripts/trace-excludes.json). Un error así (p. ej. excluir
// @swc/helpers) tumbó producción con 500 en todas las rutas. Requiere un `next build` previo.
// Aparta los paquetes de node_modules, arranca `next start`, pide las rutas y los restaura siempre.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = process.env.CHECK_RUNTIME_PORT ?? "3114";
const BASE = `http://127.0.0.1:${PORT}`;
const RUTAS = ["/", "/login", "/registro", "/api/ping", "/inicio"];
const PANTALLAS_CON_ACCIONES = ["/inicio", "/movimientos", "/plan", "/ajustes", "/cuentas"];
const NM = "node_modules";
const BAK = join(NM, ".runtime-check-bak");

if (!existsSync(".next/BUILD_ID")) {
  console.error("Falta el build: ejecuta `npm run build` antes.");
  process.exit(1);
}

// "./node_modules/@swc/core*/**/*" -> ["@swc/core*"]
const leer = (f) => JSON.parse(readFileSync(f, "utf8")).map((g) => g.replace(/^\.\/node_modules\//, "").replace(/\/\*\*\/\*$/, ""));
const excluidosSiempre = leer("scripts/trace-excludes.json");
const excluidosImagen = leer("scripts/trace-excludes-imagen.json"); // fuera de todas las funciones menos /api/ticket
const patrones = [...excluidosSiempre, ...excluidosImagen];

// La traza de cada función dice qué se sube con ella: sharp y libvips solo con la de las fotos, y con esa sí o sí.
// (La traza común `next-server` no se mira: Next la limpia de sharp únicamente cuando construye en Vercel.)
function comprobarTrazas() {
  const listar = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(join(d, e.name)) : [join(d, e.name)]));
  const trazas = listar(".next/server").filter((f) => f.endsWith(".nft.json"));
  const ticket = join(".next", "server", "app", "api", "ticket", "route.js.nft.json");
  let mal = 0;
  const sobran = trazas.filter((f) => f !== ticket && JSON.parse(readFileSync(f, "utf8")).files.some((x) => /node_modules\/(sharp|@img)\//.test(x)));
  if (sobran.length) { console.log(`FALLO sharp en funciones que no lo necesitan: ${sobran.slice(0, 5).join(", ")}`); mal++; }
  const suyos = trazas.includes(ticket) ? JSON.parse(readFileSync(ticket, "utf8")).files : [];
  for (const [que, re] of [["sharp", /node_modules\/sharp\//], ["el binario de sharp", /node_modules\/@img\/sharp-(?!libvips)/], ["libvips", /node_modules\/@img\/sharp-libvips/]]) {
    if (!suyos.some((x) => re.test(x))) { console.log(`FALLO /api/ticket no lleva ${que}`); mal++; }
  }
  if (!mal) console.log(`OK    trazas: sharp solo en /api/ticket (${trazas.length} funciones revisadas)`);
  return mal;
}

function expandir(patron) {
  if (!patron.includes("*")) return existsSync(join(NM, patron)) ? [patron] : [];
  const dir = dirname(patron);
  const base = patron.slice(dir === "." ? 0 : dir.length + 1);
  const re = new RegExp(`^${base.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  const padre = dir === "." ? NM : join(NM, dir);
  if (!existsSync(padre)) return [];
  return readdirSync(padre).filter((n) => re.test(n)).map((n) => (dir === "." ? n : `${dir}/${n}`));
}

const paquetes = [...new Set(patrones.flatMap(expandir))];
const movidos = [];

/** Devuelve a node_modules lo apartado: todo, o solo lo que case con `solo`. */
function restaurar(solo) {
  const toca = (p) => !solo || solo.some((patron) => p === patron || p.startsWith(`${patron}/`));
  for (const p of movidos.filter(toca).reverse()) {
    mkdirSync(dirname(join(NM, p)), { recursive: true });
    renameSync(join(BAK, p), join(NM, p));
    movidos.splice(movidos.indexOf(p), 1);
  }
  if (movidos.length === 0) rmSync(BAK, { recursive: true, force: true });
}

let server;
let fallos = comprobarTrazas();
try {
  if (existsSync(BAK)) {
    console.error(`${BAK} existe de una ejecución anterior interrumpida: restáuralo a mano antes de seguir.`);
    process.exit(1);
  }
  for (const p of paquetes) {
    mkdirSync(dirname(join(BAK, p)), { recursive: true });
    renameSync(join(NM, p), join(BAK, p));
    movidos.push(p);
  }
  console.log(`Sin ${paquetes.length} paquetes excluidos: ${paquetes.join(", ")}`);

  let salida = "";
  server = spawn("node", ["node_modules/next/dist/bin/next", "start", "-p", PORT, "-H", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => (salida += d));
  server.stderr.on("data", (d) => (salida += d));
  let caido = false;
  server.on("exit", () => (caido = true));

  // Espera a que responda cualquier cosa (hasta 40 s) o a que el proceso muera
  let arriba = false;
  for (let i = 0; i < 80 && !caido && !arriba; i++) {
    try {
      await fetch(BASE + "/api/ping", { signal: AbortSignal.timeout(2000) });
      arriba = true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!arriba) {
    console.error("`next start` no llegó a responder:\n" + salida.split("\n").slice(0, 12).join("\n"));
    fallos++;
  } else {
    for (const path of RUTAS) {
      const headers = path === "/inicio" ? { cookie: "fifti_demo=1" } : undefined;
      const r = await fetch(BASE + path, { redirect: "manual", headers, signal: AbortSignal.timeout(20000) });
      const ok = r.status === 200;
      if (!ok) fallos++;
      console.log(`${ok ? "OK   " : "FALLO"} ${r.status} ${path}`);
    }
    // Cargar una pantalla no basta: sus server actions se cargan aparte, todas juntas, y un módulo que falte las tumba todas.
    // Se ejecuta una de verdad (la de la hoja «Nuevo gasto», en la demo: no escribe nada) en varias pantallas.
    const acciones = Object.entries(JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node);
    const hoja = acciones.find(([, a]) => a.exportedName === "loadSheetContext")?.[0];
    if (!hoja) { console.error("FALLO no se encuentra la server action de prueba"); fallos++; }
    else for (const path of PANTALLAS_CON_ACCIONES) {
      const r = await fetch(BASE + path, {
        method: "POST", redirect: "manual", body: "[]", signal: AbortSignal.timeout(20000),
        headers: { cookie: "fifti_demo=1", origin: BASE, accept: "text/x-component", "content-type": "text/plain;charset=UTF-8", "next-action": hoja },
      });
      const cuerpo = await r.text();
      const ok = r.status === 200 && cuerpo.includes('"spaces"');
      if (!ok) fallos++;
      console.log(`${ok ? "OK   " : "FALLO"} ${r.status} POST ${path} (server action)`);
    }
    // Ya se ha visto que nada más necesita sharp: se le devuelve, como a la función de las fotos, y procesa una imagen
    restaurar(excluidosImagen);
    const foto = await fetch(`${BASE}/api/ticket`, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    const fotoOk = foto.status === 200 && (await foto.text()).includes('"ok":true');
    if (!fotoOk) fallos++;
    console.log(`${fotoOk ? "OK   " : "FALLO"} ${foto.status} /api/ticket (procesa una imagen)`);
    // Sin sesión no se sube nada
    const anonima = await fetch(`${BASE}/api/ticket`, { method: "POST", redirect: "manual", body: new FormData(), headers: { origin: BASE }, signal: AbortSignal.timeout(20000) });
    const cerrada = [401, 413].includes(anonima.status);
    if (!cerrada) fallos++;
    console.log(`${cerrada ? "OK   " : "FALLO"} ${anonima.status} POST /api/ticket sin sesión`);
    if (fallos) console.error("\n" + salida.split("\n").filter((l) => /error|cannot find/i.test(l)).slice(0, 8).join("\n"));
  }
} finally {
  server?.kill();
  restaurar();
}

if (fallos) {
  console.error("\ncheck:runtime FALLÓ: algún paquete excluido hace falta en runtime.");
  process.exit(1);
}
console.log("\ncheck:runtime OK.");
