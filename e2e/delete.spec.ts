import { expect, test, type Page } from "@playwright/test";
import { e2eConfigured, login, newUser, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas (.env.test.local)");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

async function seedDinner() {
  const p = await personalOf(ana);
  await seedExpense(ana, p.spaceId, p.memberId, "Viernes noche", 2000);
  return (await ana.client.from("expenses").select("id").eq("description", "Viernes noche").single()).data!.id as string;
}

/** Apunta cualquier respuesta 404 o pantalla de "no encontrado", aunque solo dure un instante. */
async function watchNotFound(page: Page) {
  const seen: string[] = [];
  page.on("response", (r) => { if (r.status() === 404) seen.push(`HTTP 404 ${new URL(r.url()).pathname}`); });
  await page.exposeFunction("reportNotFound", () => { seen.push("pantalla 404"); });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (/This page could not be found/i.test(document.body?.textContent ?? "") && document.querySelector("h1")?.textContent === "404") {
        (window as unknown as { reportNotFound: () => void }).reportNotFound();
      }
    }).observe(document, { subtree: true, childList: true });
  });
  return seen;
}

/** Marca la sesión como caducada: la siguiente petición la renueva y reescribe las cookies (lo que pasa al rato de tener la app abierta). */
async function expireSession(page: Page) {
  const context = page.context();
  const cookies = (await context.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  const raw = cookies.map((c) => decodeURIComponent(c.value)).join("").replace(/^base64-/, "");
  const session = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  const value = "base64-" + Buffer.from(JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 10 })).toString("base64url");
  const name = cookies[0]!.name.replace(/\.\d+$/, "");
  const chunks = value.match(/.{1,3000}/g)!;
  await context.clearCookies({ name: /^sb-.*-auth-token/ });
  await context.addCookies(chunks.map((v, i) => ({ ...cookies[0]!, name: chunks.length === 1 ? name : `${name}.${i}`, value: v })));
}

async function deleteAndCheck(page: Page) {
  await page.getByRole("button", { name: "Borrar", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page).toHaveURL(/\/movimientos$/);
  await expect(page.getByRole("status").filter({ hasText: "Gasto borrado" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Movimientos" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Viernes noche/ })).toHaveCount(0);
}

test("borrar un gasto abierto desde la lista vuelve a Movimientos con aviso y sin 404", async ({ page }) => {
  await seedDinner();
  const notFound = await watchNotFound(page);
  await login(page, ana);
  await page.goto("/movimientos");
  await page.getByRole("link", { name: /Viernes noche/ }).click();
  await expect(page.getByRole("heading", { name: "Viernes noche" })).toBeVisible();
  await deleteAndCheck(page);
  expect(notFound).toEqual([]);
});

test("borrar un gasto abierto por su enlace vuelve a Movimientos con aviso y sin 404", async ({ page }) => {
  const id = await seedDinner();
  const notFound = await watchNotFound(page);
  await login(page, ana);
  await page.goto(`/movimientos/${id}`);
  await deleteAndCheck(page);
  expect(notFound).toEqual([]);
});

test("borrar justo cuando se renueva la sesión no acaba en 404", async ({ page }) => {
  await seedDinner();
  const notFound = await watchNotFound(page);
  await login(page, ana);
  await page.goto("/movimientos");
  await page.getByRole("link", { name: /Viernes noche/ }).click();
  await expect(page.getByRole("heading", { name: "Viernes noche" })).toBeVisible();
  await expireSession(page);
  await deleteAndCheck(page);
  expect(notFound).toEqual([]);
});

test("el enlace de un gasto que ya no existe lo dice y deja volver, sin 404", async ({ page }) => {
  const notFound = await watchNotFound(page);
  await login(page, ana);
  const res = await page.goto(`/movimientos/${crypto.randomUUID()}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Este gasto ya no existe" })).toBeVisible();
  await page.getByRole("link", { name: "Volver a Movimientos" }).click();
  await expect(page).toHaveURL(/\/movimientos$/);
  expect(notFound).toEqual([]);
});

test("un id que no es válido responde 404 de verdad", async ({ page }) => {
  await login(page, ana);
  const res = await page.goto("/movimientos/no-es-un-id");
  expect(res?.status()).toBe(404);
});

test("borrar un gasto fijo vuelve a la lista de fijos y ya no aparece", async ({ page }) => {
  const p = await personalOf(ana);
  const today = new Date().toISOString().slice(0, 10);
  const { data: id } = await ana.client.rpc("save_recurring", {
    p: { space_id: p.spaceId, description: "Gimnasio de Leo", amount_cents: 2500, frequency: "monthly", day: 5, next_run: today, paid_from: "member" },
  });
  const notFound = await watchNotFound(page);
  await login(page, ana);
  await page.goto("/plan?vista=fijos");
  await page.getByRole("link", { name: /Gimnasio de Leo/ }).click();
  await expect(page).toHaveURL(new RegExp(`/fijos/nuevo\\?id=${id}`));
  await page.getByRole("button", { name: "Borrar gasto fijo" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page).toHaveURL(/\/plan\?vista=fijos$/);
  await expect(page.getByRole("status").filter({ hasText: "Gasto fijo borrado" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Gimnasio de Leo/ })).toHaveCount(0);
  expect(notFound).toEqual([]);
});
