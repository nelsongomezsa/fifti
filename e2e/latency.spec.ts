import { expect, test } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, openSheet, removeUsers, seedPlan, typeAmount, type TestUser } from "./helpers";

// Mide cuánto tarda en verse «Guardado» al apuntar un gasto con latencia simulada. Solo con LATENCY=300 (y solo en móvil).
test.skip(!e2eConfigured || !process.env.LATENCY, "Medición opcional: LATENCY=300 npx playwright test e2e/latency.spec.ts --project=movil");

let ana: TestUser;
test.beforeEach(async () => { ana = await newUser("Ana"); await seedPlan(ana); });
test.afterEach(async () => { await removeUsers(ana); });

test("tiempo hasta ver «Guardado» y hasta que el gasto llega a la base de datos", async ({ page, context }) => {
  const latency = Number(process.env.LATENCY);
  await login(page, ana);
  await page.waitForLoadState("networkidle");
  await openSheet(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 });
  await typeAmount(page, "9,90");
  await page.getByLabel("Concepto").fill("Café lento");
  const t0 = Date.now();
  await page.getByRole("button", { name: /^Guardar en/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardado en" })).toBeVisible();
  const feedback = Date.now() - t0;
  await expect.poll(async () => (await admin().from("expenses").select("id").eq("description", "Café lento")).data?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0);
  const persisted = Date.now() - t0;
  console.log(`LATENCIA ${latency} ms · «Guardado» visible a los ${feedback} ms · en la base de datos a los ${persisted} ms`);
  expect(feedback).toBeLessThan(500);
});
