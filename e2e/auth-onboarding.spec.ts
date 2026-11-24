import { expect, test } from "@playwright/test";
import { admin, confirmationLink, e2eConfigured, followConfirmation, loginForm, newUser, removeUsers } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas (.env.test.local)");

test("registro con correo de confirmación, bienvenida en 3 pasos y primer gasto fijo", async ({ page }) => {
  const email = `ana.${crypto.randomUUID().slice(0, 8)}@example.test`;
  const password = `Fifti-${crypto.randomUUID()}-Zx9!`;
  await page.goto("/registro");
  await page.getByLabel("Nombre").fill("Ana");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Contraseña/).first().fill(password);
  await page.getByLabel("Repetir contraseña").fill(password);
  await page.getByRole("button", { name: /Crear cuenta/ }).click();

  // Supabase local manda el correo a Mailpit: se abre el enlace de confirmación
  await page.goto(await followConfirmation(await confirmationLink(email)));
  await expect(page).toHaveURL(/\/(bienvenida|inicio|login)/);
  if (/login/.test(page.url())) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
  }
  await page.goto("/bienvenida");

  await expect(page.getByText("Paso 1 de 3")).toBeVisible();
  await page.getByLabel("Tus ingresos").fill("2100");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Paso 2 de 3")).toBeVisible();
  await page.getByRole("button", { name: "Guardar plan" }).click();
  await expect(page.getByText("Paso 3 de 3")).toBeVisible(); // tras guardar el plan sale siempre el paso 3
  await page.getByLabel("Concepto").fill("Spotify");
  await page.getByLabel("Importe").fill("10,99");
  await page.getByRole("button", { name: "Guardar y terminar" }).click();
  await expect(page).toHaveURL(/\/inicio/);
  await expect(page.getByText("Te sobrará a final de mes")).toBeVisible();

  const { data: users } = await admin().auth.admin.listUsers({ perPage: 200 });
  const me = users.users.find((u) => u.email === email);
  if (me) await admin().auth.admin.deleteUser(me.id);
});

test("el acceso rechaza una contraseña incorrecta con un mensaje claro", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nadie@example.test");
  await page.getByLabel("Contraseña").fill("incorrecta-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("el formulario de acceso entra con la contraseña correcta", async ({ page }) => {
  const u = await newUser("Ana");
  await loginForm(page, u);
  await expect(page).toHaveURL(/\/(inicio|bienvenida)/);
  await removeUsers(u);
});
