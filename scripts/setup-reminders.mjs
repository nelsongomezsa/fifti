// Configura el recordatorio diario en producción: genera un CRON_SECRET nuevo, lo guarda en Vercel y en el Vault de Supabase
// (para que pg_cron + pg_net llamen cada hora a /api/cron/reminders) y redespliega. No imprime ningún secreto.
// Uso (en tu terminal):  node scripts/setup-reminders.mjs
// Requiere: `vercel` y `supabase` con la sesión iniciada en este equipo.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const REF = "ffrwzpdemfzgeygfxgkj";
const SITE = "https://fifti-seven.vercel.app";

const raw = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-w"], { encoding: "utf8" }).trim();
const token = raw.startsWith("go-keyring-base64:") ? Buffer.from(raw.slice("go-keyring-base64:".length), "base64").toString("utf8") : raw;
const secret = randomBytes(32).toString("hex");

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  if (!r.ok) throw new Error(`SQL: HTTP ${r.status} ${(await r.text()).slice(0, 200).replace(secret, "***")}`);
  return r.json();
}
const step = (m) => console.log("•", m);

step("Vercel: sustituyendo CRON_SECRET");
spawnSync("npx", ["vercel", "env", "rm", "CRON_SECRET", "production", "--yes"], { stdio: "ignore" });
const add = spawnSync("npx", ["vercel", "env", "add", "CRON_SECRET", "production", "--sensitive"], { input: secret, stdio: ["pipe", "ignore", "inherit"] });
if (add.status !== 0) throw new Error("No se pudo guardar CRON_SECRET en Vercel");

step("Supabase: guardando app_url y cron_secret en el Vault y programando la tarea horaria");
await sql(`
  delete from vault.secrets where name in ('app_url', 'cron_secret');
  select vault.create_secret('${SITE}', 'app_url');
  select vault.create_secret('${secret}', 'cron_secret');
  create extension if not exists pg_cron;
  select cron.unschedule(jobid) from cron.job where jobname = 'fifti-reminders';
  select cron.schedule('fifti-reminders', '0 * * * *', 'select public.call_reminders()');
`);

step("Redesplegando para que Vercel use el secreto nuevo");
const dep = spawnSync("npx", ["vercel", "deploy", "--prod", "--yes"], { stdio: ["ignore", "ignore", "inherit"] });
if (dep.status !== 0) throw new Error("El despliegue falló");

step("Comprobando la ruta protegida");
const ok = await fetch(`${SITE}/api/cron/reminders`, { headers: { Authorization: `Bearer ${secret}` } });
const no = await fetch(`${SITE}/api/cron/reminders`);
console.log(`  con secreto: HTTP ${ok.status} (esperado 200) · sin secreto: HTTP ${no.status} (esperado 401)`);
const job = await sql(`select jobname, schedule, active from cron.job where jobname = 'fifti-reminders'`);
console.log("  tarea programada:", JSON.stringify(job));
console.log(ok.status === 200 && no.status === 401 ? "Listo." : "Revisa los resultados de arriba.");
