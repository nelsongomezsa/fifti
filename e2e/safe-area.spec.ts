import { expect, test, type Locator, type Page } from "@playwright/test";
import { e2eConfigured, login, newUser, removeUsers, seedPlan, type TestUser } from "./helpers";

// Viewport de iPhone con isla dinámica: Chromium permite fingir los márgenes seguros de una app instalada.
const TOP = 59;
test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
test.skip(!e2eConfigured, "Faltan las claves de pruebas");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

async function installedIphone(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride" as never, { insets: { top: TOP, bottom: 34 } } as never);
}
const box = async (l: Locator) => (await l.boundingBox())!;

test("en la app instalada el logo y Ajustes quedan por debajo de la barra de estado y se pueden pulsar", async ({ page }) => {
  await installedIphone(page);
  await login(page, ana);
  const logo = page.locator("header").getByRole("img", { name: /Fifti/i });
  const settings = page.locator("header").getByRole("link", { name: "Ajustes" });
  await expect(logo).toBeVisible();
  await expect(settings).toBeVisible();
  expect((await box(logo)).y).toBeGreaterThanOrEqual(TOP);
  const b = await box(settings);
  expect(b.y).toBeGreaterThanOrEqual(TOP);
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(393 - (b.x + b.width)).toBeGreaterThanOrEqual(16);
  await settings.tap();
  await expect(page).toHaveURL(/\/ajustes$/);
});

test("Ajustes también está en el menú del +", async ({ page }) => {
  await login(page, ana);
  await page.getByRole("button", { name: "Añadir gasto" }).click();
  await page.getByRole("dialog", { name: "¿Qué quieres apuntar?" }).getByRole("link", { name: "Ajustes" }).click();
  await expect(page).toHaveURL(/\/ajustes$/);
});

test("las pantallas sin la cabecera de la app y las hojas respetan el margen de arriba", async ({ page }) => {
  await installedIphone(page);
  for (const route of ["/", "/login", "/registro"]) {
    await page.goto(route);
    const logo = page.getByRole("img", { name: /Fifti/i }).first();
    expect((await box(logo)).y, route).toBeGreaterThanOrEqual(TOP);
  }
  await login(page, ana);
  await page.getByRole("button", { name: "Añadir gasto" }).click();
  const sheet = page.getByRole("dialog", { name: "¿Qué quieres apuntar?" });
  await expect(sheet).toBeVisible();
  await expect.poll(async () => (await box(sheet)).y).toBeGreaterThanOrEqual(TOP);
});

test("en el navegador (margen 0) la franja de arriba no ocupa nada", async ({ page }) => {
  await login(page, ana);
  expect(await page.evaluate(() => getComputedStyle(document.body.querySelector(":scope > div[aria-hidden]")!).height)).toBe("0px");
});
