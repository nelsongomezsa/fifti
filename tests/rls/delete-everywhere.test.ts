import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
const DATE = "2026-11-10";

describe.skipIf(!rlsConfigured)("borrar: quién puede cada cosa", () => {
  let ana: U, leo: U, eva: U, guest: Awaited<ReturnType<typeof createGuest>>;
  const users: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva"); guest = await createGuest();
    users.push(ana.id, leo.id, eva.id, guest.id);
  });
  afterAll(async () => { for (const id of users) await admin().auth.admin.deleteUser(id); });

  const ok = <T extends { data: unknown; error: { message: string } | null }>(r: T) => { expect(r.error?.message).toBeUndefined(); return r.data; };
  const rows = async (table: string, column: string, value: string) => (await admin().from(table).select("*").eq(column, value)).data!;
  const exists = async (table: string, id: string) => (await rows(table, "id", id)).length === 1;
  const del = (u: { client: U["client"] }, kind: string, id: string) => u.client.rpc("delete_item", { p_kind: kind, p_id: id });
  const denied = async (u: { client: U["client"] }, kind: string, id: string) => expect((await del(u, kind, id)).error?.message, `${kind}`).toBe("No autorizado");
  const insert = async (table: string, row: Record<string, unknown>) => (ok(await admin().from(table).insert(row).select("id").single()) as { id: string }).id;
  const member = async (u: { id: string }, space: string) => (await admin().from("space_members").select("id").eq("space_id", space).eq("user_id", u.id).single()).data!.id as string;
  const personal = async (u: U) => (await u.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id as string;

  /** Grupo de Ana con Leo como miembro y una persona invitada sin cuenta. Eva queda fuera. */
  async function group() {
    const space = ok(await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: "group" })) as string;
    const invite = newToken(), pass = newToken();
    ok(await ana.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: await sha256(invite), p_ttl_seconds: 3600, p_max_uses: 1 }));
    ok(await leo.client.rpc("accept_invite", { p_token_hash: await sha256(invite) }));
    ok(await ana.client.rpc("create_share_link", { p_space: space, p_kind: "guest", p_token_hash: await sha256(pass), p_ttl_seconds: 3600, p_max_uses: 5 }));
    return { space, anaM: await member(ana, space), leoM: await member(leo, space) };
  }
  const expense = async (u: U, space: string, memberId: string, extra: Record<string, unknown> = {}) =>
    ok(await u.client.rpc("save_expense", { p: {
      client_id: crypto.randomUUID(), space_id: space, description: "Viernes noche", spent_at: DATE, amount_cents: 500, currency: "EUR", fx_rate: 1, amount_base_cents: 500,
      paid_from: "member", split_mode: "equal", is_private: false, tags: [], payers: [{ member_id: memberId, amount_cents: 500 }], splits: [{ member_id: memberId, share_bp: 10000, amount_cents: 500 }], ...extra,
    } })) as string;

  it("un gasto lo borra cualquier miembro; si es privado, solo su autor; quien está fuera, nunca", async () => {
    const { space, anaM, leoM } = await group();
    const open = await expense(ana, space, anaM);
    const secret = await expense(ana, space, anaM, { is_private: true });
    await denied(eva, "expense", open);
    await denied(guest, "expense", open);
    await denied(leo, "expense", secret);
    const leos = await expense(leo, space, leoM);
    ok(await del(leo, "expense", open));
    ok(await del(ana, "expense", secret));
    ok(await del(ana, "expense", leos));
    for (const id of [open, secret, leos]) expect(await exists("expenses", id)).toBe(false);
    ok(await del(ana, "expense", open)); // repetir no es un error
  });

  it("lo compartido del espacio: miembros sí, personas de fuera no, y queda constancia", async () => {
    const { space, anaM } = await group();
    const category = (await admin().from("categories").select("id").eq("space_id", space).limit(1).single()).data!.id as string;
    const goal = await insert("savings_goals", { space_id: space, name: "Hotel", target_cents: 1000, kind: "simple" });
    const things: [string, string, string][] = [
      ["goal", "savings_goals", goal],
      ["saving_rule", "saving_rules", await insert("saving_rules", { space_id: space, goal_id: goal, kind: "roundup", value: 100 })],
      ["rule", "category_rules", await insert("category_rules", { space_id: space, match_text: "taxi", match_type: "contains", category_id: category, priority: 10 })],
      ["recurring", "recurring_expenses", ok(await ana.client.rpc("save_recurring", { p: { space_id: space, description: "Gimnasio", amount_cents: 100, frequency: "monthly", day: 5, next_run: "2027-01-05", paid_from: "member" } })) as string],
      ["tag", "tags", await insert("tags", { space_id: space, name: "playa" })],
    ];
    const list = await insert("shopping_lists", { space_id: space });
    things.push(["shopping_item", "shopping_items", await insert("shopping_items", { list_id: list, space_id: space, text: "Leche" })]);
    // las reglas de ahorro antes que su meta
    for (const [kind, table, id] of [...things].reverse()) {
      await denied(eva, kind, id);
      await denied(guest, kind, id);
      ok(await del(leo, kind, id));
      expect(await exists(table, id), kind).toBe(false);
      const log = await rows("audit_log", "row_id", id);
      expect(log.some((l) => l.action === "delete" && l.actor === leo.id && l.space_id === space), kind).toBe(true);
    }
    expect(anaM).toBeTruthy();
  });

  it("lo personal solo lo borra su dueño: comentarios, favoritos, préstamos, devoluciones y aportaciones", async () => {
    const { space, anaM } = await group();
    const spent = await expense(ana, space, anaM);
    const comment = await insert("expense_comments", { expense_id: spent, space_id: space, member_id: anaM, body: "¿Quién fue?" });
    const favorite = await insert("favorites", { user_id: ana.id, space_id: space, label: "Café", amount_cents: 200 });
    const loan = await insert("loans", { user_id: ana.id, direction: "lent", person_name: "Marta", amount_cents: 1000, loan_date: DATE });
    const repayment = await insert("loan_repayments", { loan_id: loan, user_id: ana.id, amount_cents: 100, paid_on: DATE });
    for (const [kind, table, id] of [["comment", "expense_comments", comment], ["favorite", "favorites", favorite], ["repayment", "loan_repayments", repayment], ["loan", "loans", loan]] as const) {
      await denied(leo, kind, id);
      await denied(eva, kind, id);
      ok(await del(ana, kind, id));
      expect(await exists(table, id), kind).toBe(false);
    }
    expect((await leo.client.from("audit_log").select("id").eq("row_id", loan)).data).toEqual([]);
  });

  it("traspasos y ajustes: solo quien es dueño; ingresos: solo la persona; liquidaciones: solo quien la apuntó", async () => {
    const home = await personal(ana);
    const account = async (name: string) => ok(await ana.client.rpc("save_account", { p: { space_id: home, name, kind: "daily", opening_cents: 10000, opening_date: DATE } })) as string;
    const a = await account("Nómina"), b = await account("Ahorro");
    const transfer = ok(await ana.client.rpc("create_transfer", { p_from: a, p_to: b, p_amount: 100, p_date: DATE, p_note: null, p_source: "manual" })) as string;
    ok(await ana.client.rpc("adjust_account_balance", { p_account: a, p_target: 555, p_note: null }));
    const adjustment = (await rows("account_adjustments", "account_id", a))[0]!.id as string;
    await denied(leo, "transfer", transfer);
    await denied(leo, "adjustment", adjustment);
    ok(await del(ana, "transfer", transfer));
    ok(await del(ana, "adjustment", adjustment));
    expect(await exists("account_transfers", transfer)).toBe(false);
    expect(await exists("account_adjustments", adjustment)).toBe(false);

    const { space, anaM, leoM } = await group();
    const income = ok(await leo.client.rpc("save_income", { p: { space_id: space, member_id: leoM, amount_cents: 1000, source: "Nómina", received_at: DATE } })) as string;
    expect((await del(ana, "income", income)).error?.message).toBe("No autorizado");
    ok(await del(leo, "income", income));

    const settlement = await insert("settlements", { space_id: space, from_member: leoM, to_member: anaM, amount_cents: 100, method: "cash", settled_at: DATE, created_by: leo.id });
    await denied(ana, "settlement", settlement); // ni siquiera quien administra
    ok(await del(leo, "settlement", settlement));
    expect(await exists("settlements", settlement)).toBe(false);
  });

  it("un tipo desconocido o sin sesión no borra nada", async () => {
    const { space } = await group();
    expect((await del(ana, "spaces", space)).error).not.toBeNull();
    expect(await exists("spaces", space)).toBe(true);
    expect((await ana.client.rpc("delete_item", { p_kind: "tag", p_id: space })).error).toBeNull(); // no existe: nada que hacer
  });

  it("borrar una categoría mueve sus gastos, también en un mes cerrado; las de Fifti solo se ocultan", async () => {
    const space = await personal(ana);
    const me = await member(ana, space);
    const funds = (await admin().from("funds").select("id").eq("space_id", space).limit(2)).data!;
    const own = await insert("categories", { space_id: space, fund_id: funds[0]!.id, name: "Mascota" });
    const target = await insert("categories", { space_id: space, fund_id: funds[1]!.id, name: "Veterinaria" });
    const spent = await expense(ana, space, me, { category_id: own });
    ok(await admin().from("monthly_plans").insert({ space_id: space, month: "2026-11-01", status: "closed" }));

    expect((await leo.client.rpc("delete_category", { p_id: own, p_move_to: null })).error?.message).toBe("No autorizado");
    ok(await ana.client.rpc("delete_category", { p_id: own, p_move_to: target }));
    expect((await rows("expenses", "id", spent))[0]).toMatchObject({ category_id: target, amount_cents: 500 });
    ok(await ana.client.rpc("delete_category", { p_id: target, p_move_to: null }));
    expect((await rows("expenses", "id", spent))[0]).toMatchObject({ category_id: null });

    const system = (await admin().from("categories").select("id").eq("space_id", space).not("system_key", "is", null).limit(1).single()).data!.id as string;
    expect((await ana.client.rpc("delete_category", { p_id: system, p_move_to: null })).error?.message).toMatch(/se pueden ocultar/);
    ok(await ana.client.rpc("set_category_hidden", { p_id: system, p_hidden: true }));
    expect((await rows("categories", "id", system))[0]).toMatchObject({ hidden: true });
    ok(await admin().from("monthly_plans").delete().eq("space_id", space));
  });

  it("borrar una partida propia muda sus categorías; las de Fifti no se borran", async () => {
    const space = await personal(ana);
    const base = (await admin().from("funds").select("id, system_key").eq("space_id", space)).data!;
    const own = await insert("funds", { space_id: space, name: "Caprichos", kind: "other", color: "#112233", position: 99 });
    const category = await insert("categories", { space_id: space, fund_id: own, name: "Cromos" });
    expect((await ana.client.rpc("delete_fund", { p_id: base.find((f) => f.system_key)!.id, p_move_to: own })).error?.message).toMatch(/no se puede borrar/);
    expect((await leo.client.rpc("delete_fund", { p_id: own, p_move_to: base[0]!.id })).error?.message).toBe("No autorizado");
    ok(await ana.client.rpc("delete_fund", { p_id: own, p_move_to: base[0]!.id }));
    expect(await exists("funds", own)).toBe(false);
    expect((await rows("categories", "id", category))[0]).toMatchObject({ fund_id: base[0]!.id });
  });

  it("quitar una etiqueta de un gasto y borrar la que ya no se usa", async () => {
    const { space, anaM } = await group();
    const spent = await expense(ana, space, anaM, { tags: ["cena"] });
    const tag = (await rows("tags", "space_id", space))[0]!.id as string;
    expect((await del(ana, "tag", tag)).error?.message).toMatch(/todavía se usa/);
    expect((await eva.client.rpc("remove_expense_tag", { p_expense: spent, p_tag: tag })).error?.message).toBe("No autorizado");
    ok(await leo.client.rpc("remove_expense_tag", { p_expense: spent, p_tag: tag }));
    ok(await del(ana, "tag", tag));
    expect(await exists("tags", tag)).toBe(false);
  });

  it("borrar un espacio: solo quien lo creó, nunca el Personal, y se lleva todo con sus cuentas", async () => {
    const { space, anaM, leoM } = await group();
    const spent = await expense(ana, space, anaM);
    const mine = ok(await leo.client.rpc("save_account", { p: { space_id: space, name: "Cuenta de Leo", kind: "daily", opening_cents: 1, opening_date: DATE } })) as string;
    ok(await admin().from("monthly_plans").insert({ space_id: space, month: "2026-11-01", status: "closed" }));
    for (const u of [leo, eva, guest]) expect((await u.client.rpc("delete_space", { p_space: space })).error?.message).toBe("No autorizado");
    expect((await ana.client.rpc("delete_space", { p_space: await personal(ana) })).error?.message).toBe("No autorizado");
    const result = ok(await ana.client.rpc("delete_space", { p_space: space })) as { others: string[] };
    expect(result.others).toEqual([leo.id]);
    expect(await exists("spaces", space)).toBe(false);
    expect(await exists("expenses", spent)).toBe(false);
    expect(await exists("accounts", mine)).toBe(false);
    expect(await exists("space_members", leoM)).toBe(false);
  });

  it("salir de un espacio: quien lo creó no puede; los demás conservan historial y cuentas propias", async () => {
    const { space, leoM } = await group();
    const mine = ok(await leo.client.rpc("save_account", { p: { space_id: space, name: "Cuenta de Leo", kind: "daily", opening_cents: 1, opening_date: DATE } })) as string;
    expect((await ana.client.rpc("leave_space", { p_space: space })).error?.message).toMatch(/puede borrarlo/);
    expect((await eva.client.rpc("leave_space", { p_space: space })).error?.message).toBe("No autorizado");
    ok(await leo.client.rpc("leave_space", { p_space: space }));
    expect((await rows("space_members", "id", leoM))[0]).toMatchObject({ user_id: null, display_name: "Leo" });
    expect((await rows("accounts", "id", mine))[0]).toMatchObject({ space_id: await personal(leo) });
    expect((await leo.client.from("spaces").select("id").eq("id", space)).data).toEqual([]);
  });
});
