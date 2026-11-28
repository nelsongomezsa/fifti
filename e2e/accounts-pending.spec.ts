import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { admin, e2eConfigured, login, newUser,personalOf, removeUsers, seedPlan, type TestUser } from "./helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas");
test.use({ serviceWorkers: "block" });

const today = () => new Date().toISOString().slice(0, 10);

let ana: TestUser, leo: TestUser | undefined, spaceId: string;
test.beforeEach(async () => {
  ana = await newUser("Ana"); await seedPlan(ana);
  ({ spaceId } = await personalOf(ana));
});
test.afterEach(async () => { await removeUsers(ana, leo); leo = undefined; });

const account = async (u: TestUser, space: string, name: string, kind = "daily") =>
  (await u.client.rpc("save_account", { p: { space_id: space, name, kind, opening_cents: 100000, opening_date: today() } })).data as string;
const transfer = (u: TestUser, from: string, to: string, cents: number) =>
  u.client.rpc("create_transfer", { p_from: from, p_to: to, p_amount: cents, p_date: today(), p_note: null, p_source: "manual" });

async function open(page: Page, path: string, bubble?: string) {
  await login(page, ana, bubble);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test("Archivadas: ver, recuperar y borrar", async ({ page }) => {
  const first = await account(ana, spaceId, "Cuenta antigua");
  const second = await account(ana, spaceId, "Viaje Lisboa");
  for (const id of [first, second]) await ana.client.rpc("archive_account", { p_id: id, p_archived: true });
  await open(page, "/cuentas");
  await expect(page.getByRole("link", { name: /Cuenta antigua/ })).toBeHidden();
  await page.getByText("Archivadas (2)").click();
  const row = (name: string) => page.getByRole("listitem").filter({ hasText: name });

  await row("Cuenta antigua").getByRole("button", { name: "Recuperar" }).click();
  await expect(page.getByText("Archivadas (1)")).toBeVisible();
  expect((await admin().from("accounts").select("archived_at").eq("id", first).single()).data).toEqual({ archived_at: null });

  await row("Viaje Lisboa").getByRole("button", { name: "Borrar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cuenta borrada" })).toBeVisible();
  await expect(page.getByText(/Archivadas/)).toHaveCount(0);
  expect((await admin().from("accounts").select("id").eq("id", second)).data).toEqual([]);
});

test("la confirmación dice cuánto cambiará el saldo de las otras cuentas", async ({ page }) => {
  const payroll = await account(ana, spaceId, "Nómina");
  const savings = await account(ana, spaceId, "Ahorro");
  await transfer(ana, payroll, savings, 5000);
  await open(page, `/cuentas/${payroll}`);
  await page.getByRole("button", { name: "Borrar cuenta" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("El saldo de estas cuentas cambiará:");
  await expect(dialog.getByRole("listitem")).toHaveText(/Ahorro.*−50,00/);
  await expect(dialog).not.toContainText("cuenta común");
});

/** Hogar de Ana con Leo dentro, por la API. */
async function household() {
  leo = await newUser("Leo");
  const space = (await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household", p_currency: "EUR", p_emoji: null, p_template: null, p_starts: null, p_ends: null })).data as string;
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
  expect((await ana.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: hash, p_ttl_seconds: 3600, p_max_uses: 1 })).error).toBeNull();
  expect((await leo.client.rpc("accept_invite", { p_token_hash: hash })).error).toBeNull();
  return { space, leo };
}

test("una cuenta común avisa de los traspasos de otros miembros, sin enseñar sus cuentas", async ({ page }) => {
  const { space, leo } = await household();
  const common = await account(ana, space, "Común", "shared");
  const leos = await account(leo, space, "Cuenta secreta de Leo");
  expect((await transfer(leo, leos, common, 7000)).error).toBeNull();
  await open(page, `/cuentas/${common}`, space);
  await page.getByRole("button", { name: "Borrar cuenta" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("También cambiará el saldo de cuentas de otros miembros.");
  await expect(dialog).toContainText("se borran también traspasos que apuntaron otros miembros");
  await expect(dialog).not.toContainText("Cuenta secreta");
});

test("vaciar un hogar deja intactas las cuentas de los demás", async ({ page }) => {
  const { space, leo } = await household();
  const mine = await account(ana, space, "Cuenta de Ana");
  const a = await account(leo, space, "Leo diario");
  const b = await account(leo, space, "Leo ahorro");
  await transfer(leo, a, b, 1000);
  await leo.client.rpc("adjust_account_balance", { p_account: b, p_target: 55555, p_note: null });
  await open(page, "/ajustes", space);
  await page.getByRole("button", { name: /^Casa de Ana y Leo/ }).click();
  const sheet = page.getByRole("dialog", { name: "Casa de Ana y Leo" });
  await sheet.getByLabel(/Escribe/).fill("Casa de Ana y Leo");
  await sheet.getByRole("button", { name: "Vaciar este espacio" }).click();
  await expect(sheet.getByText("Espacio vaciado.")).toBeVisible({ timeout: 20_000 });

  expect((await admin().from("accounts").select("id").eq("id", mine)).data).toEqual([]);
  expect((await admin().from("accounts").select("id").in("id", [a, b])).data).toHaveLength(2);
  expect((await admin().from("account_transfers").select("id").eq("from_account", a)).data).toHaveLength(1);
  expect((await admin().from("account_adjustments").select("id").eq("account_id", b)).data).toHaveLength(1);
});
