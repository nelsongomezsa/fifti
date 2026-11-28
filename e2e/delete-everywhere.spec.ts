import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { admin, e2eConfigured, login, newUser, personalOf, removeUsers, seedExpense, seedPlan, type TestUser } from "./helpers";
import { rowAction, swipe, swipeRow } from "./swipe-helpers";

test.skip(!e2eConfigured, "Faltan las claves de pruebas");
test.use({ serviceWorkers: "block" });

const today = () => new Date().toISOString().slice(0, 10);

let ana: TestUser, leo: TestUser | undefined, home: { spaceId: string; memberId: string };
test.beforeEach(async () => {
  ana = await newUser("Ana"); await seedPlan(ana);
  home = await personalOf(ana);
});
test.afterEach(async () => { await removeUsers(ana, leo); leo = undefined; });

const insert = async (table: string, row: Record<string, unknown>) => {
  const { data, error } = await admin().from(table).insert(row).select("id").single();
  expect(error?.message, table).toBeUndefined();
  return data!.id as string;
};
const count = async (table: string, id: string) => (await admin().from(table).select("*", { count: "exact", head: true }).eq("id", id)).count;
const gone = (table: string, id: string) => expect.poll(() => count(table, id), { timeout: 15_000, message: `${table} sigue ahí` }).toBe(0);
const account = async (name: string, space = home.spaceId) =>
  (await ana.client.rpc("save_account", { p: { space_id: space, name, kind: "daily", opening_cents: 100000, opening_date: today() } })).data as string;

async function open(page: Page, path: string, bubble?: string) {
  await login(page, ana, bubble);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Borra desde la fila, deshace, comprueba que sigue y vuelve a borrar hasta que desaparece de la base. */
async function deleteUndoDelete(page: Page, isMobile: boolean, text: string | RegExp, notice: string, table: string, id: string) {
  await rowAction(page, isMobile, text, "Borrar");
  const undo = page.getByRole("status").filter({ hasText: notice });
  await undo.getByRole("button", { name: "Deshacer" }).click();
  await expect(swipeRow(page, text)).toBeVisible();
  expect(await count(table, id)).toBe(1);
  await rowAction(page, isMobile, text, "Borrar");
  await expect(undo).toBeVisible();
  await gone(table, id);
  await expect(page.locator("[data-swipe-row]").filter({ hasText: text })).toHaveCount(0);
  await expect(page.getByText("404")).toHaveCount(0);
}

async function household() {
  leo = await newUser("Leo");
  const space = (await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household", p_currency: "EUR", p_emoji: null, p_template: null, p_starts: null, p_ends: null })).data as string;
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
  expect((await ana.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: hash, p_ttl_seconds: 3600, p_max_uses: 1 })).error).toBeNull();
  expect((await leo.client.rpc("accept_invite", { p_token_hash: hash })).error).toBeNull();
  const member = async (u: TestUser) => (await admin().from("space_members").select("id").eq("space_id", space).eq("user_id", u.id).single()).data!.id as string;
  return { space, anaM: await member(ana), leoM: await member(leo) };
}

const fixed = async (name: string) =>
  (await ana.client.rpc("save_recurring", { p: { space_id: home.spaceId, description: name, amount_cents: 2500, frequency: "monthly", day: new Date().getUTCDate(), next_run: today(), paid_from: "member" } })).data as string;

test("gasto en Movimientos", async ({ page, isMobile }) => {
  await seedExpense(ana, home.spaceId, home.memberId, "Viernes noche", 500);
  const id = (await admin().from("expenses").select("id").eq("space_id", home.spaceId).single()).data!.id as string;
  await open(page, "/movimientos");
  await deleteUndoDelete(page, isMobile, "Viernes noche", "Gasto borrado", "expenses", id);
});

for (const [where, path] of [["Plan → Fijos", "/plan?vista=fijos"], ["Calendario, próximos 30 días", "/calendario?vista=proximos"], ["Próximos de Inicio", "/inicio"]] as const) {
  test(`gasto fijo en ${where}`, async ({ page, isMobile }) => {
    const id = await fixed("Gimnasio de Leo");
    await open(page, path);
    await deleteUndoDelete(page, isMobile, "Gimnasio de Leo", "Gasto fijo borrado", "recurring_expenses", id);
  });
}

test("gasto fijo en el día del Calendario", async ({ page, isMobile }) => {
  const id = await fixed("Gimnasio de Leo");
  await open(page, "/calendario");
  await deleteUndoDelete(page, isMobile, "Gimnasio de Leo", "Gasto fijo borrado", "recurring_expenses", id);
});

test("ingreso: desde la lista y desde su botón", async ({ page, isMobile }) => {
  const income = async (source: string) =>
    (await ana.client.rpc("save_income", { p: { space_id: home.spaceId, member_id: home.memberId, amount_cents: 100000, source, received_at: today() } })).data as string;
  const first = await income("Nómina de Ana"), second = await income("Extra de verano");
  await open(page, "/inicio/ingresos");
  await deleteUndoDelete(page, isMobile, "Nómina de Ana", "Ingreso borrado", "incomes", first);
  const row = swipeRow(page, "Extra de verano");
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Borrar ingreso" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await gone("incomes", second);
  await expect(page.getByText("Aún no hay ingresos este mes.")).toBeVisible();
});

test("traspaso y ajuste de saldo en el detalle de la cuenta", async ({ page, isMobile }) => {
  const from = await account("Nómina"), to = await account("Ahorro");
  const transfer = (await ana.client.rpc("create_transfer", { p_from: from, p_to: to, p_amount: 5000, p_date: today(), p_note: null, p_source: "manual" })).data as string;
  await ana.client.rpc("adjust_account_balance", { p_account: from, p_target: 12345, p_note: null });
  const adjustment = (await admin().from("account_adjustments").select("id").eq("account_id", from).single()).data!.id as string;
  await open(page, `/cuentas/${from}`);
  await deleteUndoDelete(page, isMobile, "Traspaso a Ahorro", "Traspaso borrado", "account_transfers", transfer);
  await deleteUndoDelete(page, isMobile, "Ajuste de saldo", "Ajuste borrado", "account_adjustments", adjustment);
});

test("meta: con aportaciones pide confirmación; la aportación y la regla se deshacen; y desde el detalle", async ({ page, isMobile }) => {
  const goal = await insert("savings_goals", { space_id: home.spaceId, name: "Viaje Lisboa", target_cents: 50000, kind: "simple" });
  const contribution = await insert("goal_contributions", { goal_id: goal, space_id: home.spaceId, member_id: home.memberId, amount_cents: 1000, source: "manual", contributed_at: today() });
  const rule = await insert("saving_rules", { space_id: home.spaceId, goal_id: goal, kind: "roundup", value: 100 });
  await open(page, `/ahorro/${goal}`);
  await deleteUndoDelete(page, isMobile, "Redondeo al siguiente", "Regla borrada", "saving_rules", rule);
  await deleteUndoDelete(page, isMobile, "Manual", "Aportación borrada", "goal_contributions", contribution);
  await insert("goal_contributions", { goal_id: goal, space_id: home.spaceId, member_id: home.memberId, amount_cents: 2000, source: "manual", contributed_at: today() });

  await page.goto("/plan?vista=ahorro");
  await page.waitForLoadState("networkidle");
  await rowAction(page, isMobile, "Viaje Lisboa", "Borrar");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("sus aportaciones");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  expect(await count("savings_goals", goal)).toBe(1);

  await page.getByRole("link", { name: /Viaje Lisboa/ }).click();
  await page.getByRole("button", { name: "Borrar meta" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await expect(page).toHaveURL(/\/plan\?vista=ahorro$/);
  await expect(page.getByRole("status").filter({ hasText: "Meta borrada" })).toBeVisible();
  await gone("savings_goals", goal);
});

test("préstamo: «Pagado», borrar una devolución y borrar con confirmación si tiene pagos", async ({ page, isMobile }) => {
  const loan = async (person: string) => insert("loans", { user_id: ana.id, direction: "lent", person_name: person, amount_cents: 5000, loan_date: today() });
  const paid = await loan("Marta"), plain = await loan("Nico");
  await open(page, "/prestamos");
  await rowAction(page, isMobile, "Marta", "Pagado");
  await expect(page.getByText("Devueltos (1)")).toBeVisible();
  const repayment = (await admin().from("loan_repayments").select("id, amount_cents").eq("loan_id", paid).single()).data!;
  expect(repayment.amount_cents).toBe(5000);

  await deleteUndoDelete(page, isMobile, "Nico", "Préstamo borrado", "loans", plain);

  await page.getByText("Devueltos (1)").click();
  await rowAction(page, isMobile, "Marta", "Borrar");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("las devoluciones apuntadas");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await swipeRow(page, "Marta").locator("summary").click();
  await deleteUndoDelete(page, isMobile, /^(Borrar)?\d{1,2} \w{3}/, "Devolución borrada", "loan_repayments", repayment.id as string);
  expect(await count("loans", paid)).toBe(1);
});

test("regla de categoría y favorito", async ({ page, isMobile }) => {
  const category = (await admin().from("categories").select("id").eq("space_id", home.spaceId).limit(1).single()).data!.id as string;
  const rule = await insert("category_rules", { space_id: home.spaceId, match_text: "uberprueba", match_type: "contains", category_id: category, priority: 10 });
  const favorite = await insert("favorites", { user_id: ana.id, space_id: home.spaceId, label: "Café de Leo", amount_cents: 200 });
  await open(page, "/reglas");
  await deleteUndoDelete(page, isMobile, "uberprueba", "Regla borrada", "category_rules", rule);
  await page.goto("/ajustes");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Favoritos/ }).click();
  await deleteUndoDelete(page, isMobile, "Café de Leo", "Favorito borrado", "favorites", favorite);
});

test("categoría propia: pregunta adónde van sus gastos; la de Fifti se oculta; la partida propia se borra", async ({ page, isMobile }) => {
  const fund = (await admin().from("funds").select("id").eq("space_id", home.spaceId).order("position").limit(1).single()).data!.id as string;
  const own = await insert("categories", { space_id: home.spaceId, fund_id: fund, name: "Mascota" });
  const target = await insert("categories", { space_id: home.spaceId, fund_id: fund, name: "Veterinaria" });
  await seedExpense(ana, home.spaceId, home.memberId, "Pienso", 900);
  const expense = (await admin().from("expenses").select("id").eq("space_id", home.spaceId).single()).data!.id as string;
  await admin().from("expenses").update({ category_id: own }).eq("id", expense);
  const extra = await insert("funds", { space_id: home.spaceId, name: "Caprichos", kind: "other", color: "#112233", position: 99 });

  await open(page, `/espacio/${home.spaceId}/fondos`);
  await rowAction(page, isMobile, "Mascota", "Borrar");
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Mover sus gastos a").selectOption({ label: "Veterinaria" });
  await dialog.getByRole("button", { name: "Borrar" }).click();
  await gone("categories", own);
  expect((await admin().from("expenses").select("category_id").eq("id", expense).single()).data).toEqual({ category_id: target });

  const system = (await admin().from("categories").select("id, name").eq("space_id", home.spaceId).eq("system_key", "cat.groceries").maybeSingle()).data
    ?? (await admin().from("categories").select("id, name").eq("space_id", home.spaceId).not("system_key", "is", null).order("name").limit(1).single()).data!;
  await rowAction(page, isMobile, system.name as string, "Ocultar");
  await expect(swipeRow(page, system.name as string)).toContainText("Oculta");
  expect((await admin().from("categories").select("hidden").eq("id", system.id).single()).data).toEqual({ hidden: true });

  await rowAction(page, isMobile, "Caprichos", "Borrar");
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar" }).click();
  await gone("funds", extra);
});

test("etiquetas: quitarla del gasto y borrar la que ya no se usa", async ({ page }) => {
  await seedExpense(ana, home.spaceId, home.memberId, "Viernes noche", 500);
  const expense = (await admin().from("expenses").select("id").eq("space_id", home.spaceId).single()).data!.id as string;
  const tag = await insert("tags", { space_id: home.spaceId, name: "playa" });
  await admin().from("expense_tags").insert({ expense_id: expense, tag_id: tag });
  await open(page, `/movimientos/${expense}`);
  await page.getByRole("button", { name: "Quitar la etiqueta playa" }).click();
  await expect(page.getByText("#playa")).toHaveCount(0);
  await page.goto("/movimientos");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Filtros" }).click();
  await page.getByRole("button", { name: "Borrar la etiqueta playa" }).click();
  await gone("tags", tag);
});

test("compra, liquidación y comentario en un hogar", async ({ page, isMobile }) => {
  const { space, anaM, leoM } = await household();
  const list = await insert("shopping_lists", { space_id: space });
  const item = await insert("shopping_items", { list_id: list, space_id: space, text: "Leche de avena" });
  const settlement = await insert("settlements", { space_id: space, from_member: anaM, to_member: leoM, amount_cents: 100, method: "cash", settled_at: today(), created_by: ana.id });
  await seedExpense(ana, space, anaM, "Cena en casa", 900);
  const expense = (await admin().from("expenses").select("id").eq("space_id", space).single()).data!.id as string;
  const comment = await insert("expense_comments", { expense_id: expense, space_id: space, member_id: anaM, body: "Falta el postre" });

  await open(page, "/compra", space);
  await deleteUndoDelete(page, isMobile, "Leche de avena", "Artículo borrado", "shopping_items", item);
  await page.goto("/balance");
  await page.waitForLoadState("networkidle");
  await deleteUndoDelete(page, isMobile, /Ana → Leo.*cash/, "Pago borrado", "settlements", settlement);
  await page.goto(`/movimientos/${expense}`);
  await page.waitForLoadState("networkidle");
  await deleteUndoDelete(page, isMobile, "Falta el postre", "Comentario borrado", "expense_comments", comment);
});

test("si la app se cierra durante los 5 s, el borrado se cancela", async ({ page, isMobile, context }) => {
  await seedExpense(ana, home.spaceId, home.memberId, "Viernes noche", 500);
  const id = (await admin().from("expenses").select("id").eq("space_id", home.spaceId).single()).data!.id as string;
  await open(page, "/movimientos");
  await rowAction(page, isMobile, "Viernes noche", "Borrar");
  await expect(page.getByRole("status").filter({ hasText: "Gasto borrado" })).toBeVisible();
  await page.close();
  const again = await context.newPage();
  await again.waitForTimeout(6000);
  expect(await count("expenses", id)).toBe(1);
});

test("con el dedo: desplazar en vertical no borra y deslizar hasta el final borra al soltar", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Solo con pantalla táctil");
  await seedExpense(ana, home.spaceId, home.memberId, "Viernes noche", 500);
  const id = (await admin().from("expenses").select("id").eq("space_id", home.spaceId).single()).data!.id as string;
  await open(page, "/movimientos");
  await expect(page.getByText("Desliza una fila para borrarla o editarla")).toBeVisible();
  const content = swipeRow(page, "Viernes noche").locator("[data-swipe-content]");
  const x = async () => Math.round((await content.boundingBox())!.x);
  const start = await x();
  for (const [dx, dy] of [[0, -200], [-30, -200], [-120, -150]] as const) await swipe(page, content, dx, dy);
  await expect.poll(x).toBe(start);
  await expect(page.getByText("Gasto borrado")).toHaveCount(0);
  await swipe(page, content, -280);
  await expect(page.getByRole("status").filter({ hasText: "Gasto borrado" })).toBeVisible();
  await gone("expenses", id);
  // la pista se ve una sola vez por persona
  await page.reload();
  await expect(page.getByText("Desliza una fila para borrarla o editarla")).toHaveCount(0);
});

test("borrar un espacio escribiendo el nombre; quien no lo creó solo puede salir", async ({ page }) => {
  const { space } = await household();
  await login(page, leo!, space);
  await page.goto(`/espacio/${space}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Borrar este espacio" })).toHaveCount(0);
  await page.getByRole("button", { name: "Salir del espacio" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Salir" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Has salido del espacio" })).toBeVisible();

  await page.context().clearCookies();
  await open(page, `/espacio/${space}`, space);
  await page.getByRole("button", { name: "Borrar este espacio" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Borrar" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible(); // sin el nombre no borra
  await dialog.getByRole("textbox").fill("Casa de Ana y Leo");
  await dialog.getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Espacio borrado" })).toBeVisible();
  await gone("spaces", space);
});
