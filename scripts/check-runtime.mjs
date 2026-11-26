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
const NM = "node_modules";
const BAK = join(NM, ".runtime-check-bak");

if (!existsSync(".next/BUILD_ID")) {
  console.error("Falta el build: ejecuta `npm run build` antes.");
  process.exit(1);
}

// "./node_modules/@swc/core*/**/*" -> ["@swc/core*"]
const patrones = JSON.parse(readFileSync("scripts/trace-excludes.json", "utf8")).map((g) => g.replace(/^\.\/node_modules\//, "").replace(/\/\*\*\/\*$/, ""));

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

function restaurar() {
  for (const p of movidos.splice(0).reverse()) {
    mkdirSync(dirname(join(NM, p)), { recursive: true });
    renameSync(join(BAK, p), join(NM, p));
  }
  rmSync(BAK, { recursive: true, force: true });
}

let server;
let fallos = 0;
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
