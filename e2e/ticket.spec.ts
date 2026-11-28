import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { admin, e2eConfigured, login, newUser, openSheet, personalOf, removeUsers, seedExpense, seedPlan, typeAmount, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";

let ana: TestUser, leo: TestUser | undefined;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana, leo); leo = undefined; });

/** Foto inventada con metadatos y posición GPS, como las del móvil. */
const photoWithGps = () => sharp({ create: { width: 60, height: 40, channels: 3, background: "#C8F060" } })
  .withExif({ IFD0: { Copyright: "Ana ficticia" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "33/1 52/1 0/1" } })
  .jpeg().toBuffer();
const jpeg = (name: string, buffer: Buffer) => ({ name, mimeType: "image/jpeg", buffer });

async function dinner() {
  const p = await personalOf(ana);
  await seedExpense(ana, p.spaceId, p.memberId, "Viernes noche", 2000);
  return (await ana.client.from("expenses").select("id").eq("description", "Viernes noche").single()).data!.id as string;
}
const receiptPath = async (id: string) => (await admin().from("expenses").select("receipt_path").eq("id", id).single()).data!.receipt_path as string | null;

async function openExpense(page: Page, id: string) {
  await login(page, ana);
  await page.goto(`/movimientos/${id}`);
  await page.waitForLoadState("networkidle");
}

test("la foto del ticket se sube sin metadatos, al bucket privado y se ve con URL firmada", async ({ page, request }) => {
  const original = await photoWithGps();
  expect((await sharp(original).metadata()).exif).toBeDefined();
  const id = await dinner();
  await openExpense(page, id);
  await page.getByLabel("Foto del ticket").setInputFiles(jpeg("ticket.jpg", original));
  const image = page.getByRole("img", { name: "Foto del ticket" });
  await expect(image).toBeVisible();

  const url = (await image.getAttribute("src"))!;
  expect(url).toContain("/storage/v1/object/sign/receipts/");
  const stored = await (await request.get(url)).body();
  const meta = await sharp(stored).metadata();
  expect(meta.format).toBe("webp");
  expect(meta.exif).toBeUndefined();
  // Sin la firma no se puede ver
  const path = (await receiptPath(id))!;
  expect((await request.get(`${new URL(url).origin}/storage/v1/object/public/receipts/${path}`)).ok()).toBe(false);
});

test("una foto grande del móvil se reduce en el dispositivo y se sube", async ({ page }) => {
  const big = await sharp(randomBytes(2400 * 2400 * 3), { raw: { width: 2400, height: 2400, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  expect(big.length).toBeGreaterThan(4 * 1024 * 1024);
  const id = await dinner();
  await openExpense(page, id);
  await page.getByLabel("Foto del ticket").setInputFiles(jpeg("grande.jpg", big));
  await expect(page.getByRole("img", { name: "Foto del ticket" })).toBeVisible({ timeout: 20_000 });
});

async function sheetWithPhoto(page: Page, concept: string) {
  await login(page, ana);
  await openSheet(page);
  await typeAmount(page, "9");
  const sheet = page.getByRole("dialog", { name: "Nuevo gasto" });
  await sheet.getByLabel("Concepto").fill(concept);
  await sheet.getByText("Más opciones").click();
  await sheet.getByLabel("Foto del ticket").setInputFiles(jpeg("ticket.jpg", await photoWithGps()));
  await sheet.getByRole("button", { name: /^Guardar en/ }).click();
  return sheet;
}
const saved = async (concept: string) => (await ana.client.from("expenses").select("receipt_path").eq("description", concept)).data ?? [];

test("apuntar un gasto con foto desde el + la guarda con el gasto", async ({ page }) => {
  await sheetWithPhoto(page, "Cena con ticket");
  await expect.poll(async () => (await saved("Cena con ticket"))[0]?.receipt_path ?? null, { timeout: 20_000 }).not.toBeNull();
});

test("si la foto falla se avisa y el gasto no se guarda dos veces", async ({ page }) => {
  await page.route("**/api/ticket", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "No se ha podido procesar la foto." }) }));
  const sheet = await sheetWithPhoto(page, "Cena sin ticket");
  await expect(sheet.getByRole("alert")).toContainText("El gasto se ha guardado, pero la foto no.");
  await sheet.getByRole("button", { name: "Entendido" }).click();
  await expect(sheet).toHaveCount(0);
  expect(await saved("Cena sin ticket")).toHaveLength(1);
});

test("la ruta de subida rechaza lo que no debe", async ({ page, request }) => {
  const id = await dinner();
  const photo = await photoWithGps();
  const send = (client: typeof request, buffer: Buffer, origin = BASE) =>
    client.post("/api/ticket", { headers: { origin }, multipart: { expenseId: id, file: jpeg("ticket.jpg", buffer) } });

  expect((await send(request, photo)).status()).toBe(401); // sin sesión
  await login(page, ana);
  expect((await send(page.request, photo, "https://otra-web.example")).status()).toBe(403); // otra procedencia
  expect((await send(page.request, Buffer.from("<html>no soy una foto</html>"))).status()).toBe(415); // el nombre no basta
  expect((await send(page.request, Buffer.concat([photo, Buffer.alloc(4 * 1024 * 1024)]))).status()).toBe(413);
  expect((await page.request.post("/api/ticket", { headers: { origin: BASE }, multipart: { expenseId: id, otro: "x", file: jpeg("t.jpg", photo) } })).status()).toBe(400);

  // Otra persona, con su sesión, no puede ponerle foto a este gasto
  leo = await newUser("Leo");
  await page.context().clearCookies();
  await login(page, leo);
  expect((await send(page.request, photo)).status()).toBe(404);
  expect(await receiptPath(id)).toBeNull();
});
