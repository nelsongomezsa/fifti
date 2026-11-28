// Comprobación rápida de producción tras un despliegue: solo GET a fifti-seven.vercel.app.
// Sale con código 1 si alguna ruta no responde 200.
const BASE = "https://fifti-seven.vercel.app";
const RUTAS = [
  { path: "/" },
  { path: "/login" },
  { path: "/registro" },
  { path: "/api/ping" },
  { path: "/api/ticket" }, // procesa una imagen de prueba: dice si sharp funciona en la función de las fotos
  { path: "/inicio", headers: { cookie: "fifti_demo=1" } },
];

let fallos = 0;
for (const { path, headers } of RUTAS) {
  try {
    const r = await fetch(BASE + path, { method: "GET", redirect: "manual", headers, signal: AbortSignal.timeout(20000) });
    const ok = r.status === 200;
    if (!ok) fallos++;
    console.log(`${ok ? "OK  " : "FALLO"} ${r.status} ${path}`);
  } catch (e) {
    fallos++;
    console.log(`FALLO ERR ${path} (${e instanceof Error ? e.message : e})`);
  }
}
if (fallos) {
  console.error(`\n${fallos} ruta(s) sin 200: hacer rollback.`);
  process.exit(1);
}
console.log("\nTodo en 200.");
