import { expect, test } from "@playwright/test";
import { admin, waitCaptcha, e2eConfigured, login, newUser, openSheet, removeUsers, seedPlan, typeAmount, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas (.env.test.local)");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

test("sin conexión el gasto se guarda en la cola y se envía al volver la red", async ({ page, context }) => {
  await login(page, ana);
  await page.waitForLoadState("networkidle");
  await openSheet(page); // la hoja ya está cargada (y su contexto guardado) antes de cortar la red
  await context.setOffline(true);
  await typeAmount(page, "4,20");
  await page.getByLabel("Concepto").fill("Café sin red");
  await page.getByRole("button", { name: /^Guardar en/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /sin conexión|Guardado/ })).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(async () => (await admin().from("expenses").select("id").eq("description", "Café sin red")).data?.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
});

test("un invitado entra a un plan de grupo con Turnstile (claves de prueba de Cloudflare)", async ({ page, browser }) => {
  test.skip(!process.env.E2E_TURNSTILE_TEST, "Requiere compilar la app con las claves de prueba de Turnstile (E2E_TURNSTILE_TEST=1)");
  const { data: group } = await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: "group", p_currency: "EUR", p_emoji: null, p_template: null, p_starts: null, p_ends: null });
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"); // 32 bytes, como los enlaces reales
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
  await ana.client.rpc("create_share_link", { p_space: group as string, p_kind: "guest", p_token_hash: hash, p_ttl_seconds: 3600, p_max_uses: 3 });
  void page;
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(`${process.env.E2E_BASE_URL ?? "http://localhost:3113"}/unirse/${token}`);
  await guest.getByLabel("Tu nombre").fill("Marta");
  await waitCaptcha(guest); // el widget de prueba de Cloudflare se resuelve solo
  await guest.getByRole("button", { name: "Entrar al plan" }).click();
  await expect(guest).toHaveURL(/\/(inicio|movimientos|espacio)/);
  await ctx.close();
});
