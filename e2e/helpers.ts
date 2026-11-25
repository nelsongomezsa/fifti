import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { expect, type BrowserContext, type Page } from "@playwright/test";

config({ path: ".env.test.local", quiet: true });

const url = process.env.TEST_SUPABASE_URL;
const anon = process.env.TEST_SUPABASE_ANON_KEY;
const service = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
export const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
export const e2eConfigured = Boolean(url && anon && service);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = () => createClient(url!, service!, opts);

export type TestUser = { id: string; name: string; email: string; password: string; client: SupabaseClient };

/** Usuario ficticio ya confirmado, con un cliente de API con su sesión (sirve para sembrar datos). */
export async function newUser(name: string): Promise<TestUser> {
  const email = `${name.toLowerCase()}.${crypto.randomUUID().slice(0, 8)}@example.test`;
  const password = `Pw-${crypto.randomUUID()}-Ok1`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
  if (error || !data.user) throw error ?? new Error("no se pudo crear el usuario");
  const client = createClient(url!, anon!, opts);
  const { error: signErr } = await client.auth.signInWithPassword({ email, password, options: { captchaToken: TEST_CAPTCHA_TOKEN } });
  if (signErr) throw signErr;
  return { id: data.user.id, name, email, password, client };
}

export async function removeUsers(...users: (TestUser | undefined)[]) {
  for (const u of users) if (u) await admin().auth.admin.deleteUser(u.id);
}

/** Espacio personal, su miembro y sus fondos. */
export async function personalOf(u: TestUser) {
  const { data: sp } = await u.client.from("spaces").select("id").eq("kind", "personal").single();
  const { data: me } = await u.client.from("space_members").select("id").eq("space_id", sp!.id).single();
  const { data: funds } = await u.client.from("funds").select("id, kind, name").eq("space_id", sp!.id);
  return { spaceId: sp!.id as string, memberId: me!.id as string, funds: funds ?? [] };
}

const monthStart = () => new Date().toISOString().slice(0, 8) + "01";

/** Plan del mes en curso con ingresos de 2.000 € y reparto por fondos. */
export async function seedPlan(u: TestUser) {
  const p = await personalOf(u);
  const amounts: Record<string, number> = { fixed: 90000, variable: 40000, leisure: 20000, savings: 30000 };
  const { error } = await u.client.rpc("save_plan", {
    p: {
      space_id: p.spaceId, month: monthStart(), incomes: [{ member_id: p.memberId, expected_cents: 200000 }],
      allocations: p.funds.map((f) => ({ fund_id: f.id, mode: "amount", value: amounts[f.kind] ?? 0, planned_cents: amounts[f.kind] ?? 0 })),
    },
  });
  if (error) throw error;
  return p;
}

export async function seedExpense(u: TestUser, spaceId: string, memberId: string, description: string, cents: number) {
  const { error } = await u.client.rpc("save_expense", {
    p: {
      client_id: crypto.randomUUID(), space_id: spaceId, description, spent_at: new Date().toISOString().slice(0, 10), amount_cents: cents, currency: "EUR", fx_rate: 1, amount_base_cents: cents,
      paid_from: "member", split_mode: "equal", is_private: false, tags: [], payers: [{ member_id: memberId, amount_cents: cents }], splits: [{ member_id: memberId, share_bp: 10000, amount_cents: cents }],
    },
  });
  if (error) throw error;
}

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";

/** Cookie de sesión como la deja @supabase/ssr (base64 y troceada), para no pasar por el formulario en cada prueba (el acceso tiene límite de intentos). */
async function sessionCookies(u: TestUser) {
  const { data } = await u.client.auth.getSession();
  const enc = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  const name = `sb-${new URL(url!).hostname.split(".")[0]}-auth-token`;
  const chunks = enc.match(/.{1,3000}/g)!;
  return (chunks.length === 1 ? [[name, enc]] : chunks.map((c, i) => [`${name}.${i}`, c])).map(([n, v]) => ({ name: n!, value: v!, url: BASE }));
}

/** Entra con la sesión del usuario (cookies). Con `bubbleId` deja esa burbuja como activa. */
export async function login(page: Page, u: TestUser, bubbleId?: string) {
  const ctx: BrowserContext = page.context();
  await ctx.addCookies([{ name: "fifti_locale", value: "es", url: BASE }, ...(await sessionCookies(u))]);
  if (bubbleId) await ctx.addCookies([{ name: "fifti_bubble", value: bubbleId, url: BASE }]);
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/(inicio|bienvenida)/);
}

/** Entra por el formulario de acceso (para la prueba del propio formulario). */
/** Con Turnstile activo (claves de prueba de Cloudflare) espera a que el formulario tenga su token; sin widget no espera nada. */
export async function waitCaptcha(page: Page) {
  await page.waitForFunction(() => { const i = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]'); return !i || i.value.length > 0; }, undefined, { timeout: 20_000 });
}

/** Token de prueba que acepta Supabase cuando el captcha está activado con la clave secreta de prueba de Cloudflare. */
export const TEST_CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export async function loginForm(page: Page, u: TestUser) {
  await page.context().addCookies([{ name: "fifti_locale", value: "es", url: BASE }]);
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Contraseña").fill(u.password);
  await waitCaptcha(page);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/(inicio|bienvenida)/);
}

/** Teclea un importe con el teclado de la hoja: "12,50". */
export async function typeAmount(page: Page, amount: string) {
  const pad = page.getByRole("group", { name: "Teclado numérico" });
  for (const ch of amount) await pad.getByRole("button", { name: ch === "," ? "Coma decimal" : ch, exact: true }).click();
}

export async function openSheet(page: Page) {
  await page.getByRole("button", { name: "Añadir gasto" }).click();
  await page.getByRole("dialog", { name: "¿Qué quieres apuntar?" }).getByRole("button", { name: /^Gasto/ }).click(); // selector del +
  await expect(page.getByRole("dialog", { name: "Nuevo gasto" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Teclado numérico" })).toBeVisible(); // la hoja ya cargó su contexto (no es el esqueleto)
}

/** Sigue el enlace de confirmación sin pasar por el navegador y devuelve la URL de la app a la que redirige (con el código de acceso). */
export async function followConfirmation(link: string): Promise<string> {
  const res = await fetch(link, { redirect: "manual" });
  const loc = res.headers.get("location");
  if (!loc) throw new Error(`el enlace de confirmación no redirige (HTTP ${res.status})`);
  return loc.replace(/^https?:\/\/localhost:\d+/, BASE).replace(/^https?:\/\/127\.0\.0\.1:\d+(?=\/auth\/callback)/, BASE);
}

/** Último correo para esa dirección en Mailpit (Supabase local) y el primer enlace que lleva. */
export async function confirmationLink(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list = (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string }[] };
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
      const m = /https?:\/\/[^\s"<>]+/.exec(`${msg.Text ?? ""} ${msg.HTML ?? ""}`);
      if (m) return m[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no llegó el correo de confirmación");
}

/** Espera a que el gasto esté de verdad en la base de datos (el aviso de «Guardado» sale antes: el guardado es optimista). */
export async function waitForExpense(u: TestUser, description: string) {
  await expect.poll(async () => (await u.client.from("expenses").select("id").eq("description", description)).data?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
}
