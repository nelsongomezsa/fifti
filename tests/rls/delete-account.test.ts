import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
const DATE = "2026-11-10";

describe.skipIf(!rlsConfigured)("borrar cuentas bancarias y vaciar un espacio con ellas", () => {
  let ana: U, leo: U;
  const users: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); users.push(ana.id, leo.id);
  });
  afterAll(async () => { for (const id of users) await admin().auth.admin.deleteUser(id); });

  const ok = <T extends { data: unknown; error: { message: string } | null }>(r: T) => { expect(r.error?.message).toBeUndefined(); return r.data; };
  const personal = async (u: U) => {
    const space = (await u.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id as string;
    const member = (await u.client.from("space_members").select("id").eq("space_id", space).single()).data!.id as string;
    return { space, member };
  };
  const account = async (u: U, space: string, name: string, extra: Record<string, unknown> = {}) =>
    ok(await u.client.rpc("save_account", { p: { space_id: space, name, kind: "daily", opening_cents: 10000, opening_date: DATE, ...extra } })) as string;
  const expense = async (u: U, space: string, member: string, accountId: string) => {
    const id = ok(await u.client.rpc("save_expense", { p: {
      client_id: crypto.randomUUID(), space_id: space, description: "Viernes noche", spent_at: DATE, amount_cents: 500, currency: "EUR", fx_rate: 1, amount_base_cents: 500,
      paid_from: "member", split_mode: "equal", is_private: false, tags: [], payers: [{ member_id: member, amount_cents: 500 }], splits: [{ member_id: member, share_bp: 10000, amount_cents: 500 }],
    } })) as string;
    ok(await u.client.rpc("set_movement_account", { p_kind: "expense", p_id: id, p_account: accountId }));
    return id;
  };
  const rows = async (table: string, column: string, value: string) => (await admin().from(table).select("*").eq(column, value)).data!;
  const one = async (table: string, id: string) => (await rows(table, "id", id))[0];

  /** Hogar de Ana con Leo dentro, y una cuenta de cada uno. */
  async function home() {
    const space = ok(await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household" })) as string;
    const token = newToken();
    ok(await ana.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: await sha256(token), p_ttl_seconds: 3600, p_max_uses: 1 }));
    ok(await leo.client.rpc("accept_invite", { p_token_hash: await sha256(token) }));
    const member = (await ana.client.from("space_members").select("id").eq("space_id", space).eq("user_id", ana.id).single()).data!.id as string;
    const anas = await account(ana, space, "Cuenta de Ana");
    const leos = await account(leo, space, "Cuenta de Leo");
    return { space, member, anas, leos };
  }

  it("solo la borra su dueño: ni otra persona, ni un invitado, ni sin sesión, ni a mano", async () => {
    const { space, anas, leos } = await home();
    const shared = await account(ana, space, "Común", { kind: "shared" });
    for (const id of [anas, shared]) expect((await leo.client.rpc("delete_account", { p_id: id })).error?.message).toBe("No autorizado");
    expect((await ana.client.rpc("delete_account", { p_id: leos })).error?.message).toBe("No autorizado");
    const guest = await createGuest();
    users.push(guest.id);
    expect((await guest.client.rpc("delete_account", { p_id: anas })).error?.message).toBe("No autorizado");
    expect((await ana.client.from("accounts").delete().eq("id", anas)).error).not.toBeNull();
    expect((await ana.client.rpc("_delete_account" as string, { p_id: leos })).error).not.toBeNull();
    for (const id of [anas, leos, shared]) expect(await one("accounts", id)).toBeDefined();
  });

  it("borra traspasos y ajustes; los movimientos y partidas se quedan, sin cuenta, también en un mes cerrado", async () => {
    const { space, member } = await personal(ana);
    const first = await account(ana, space, "Nómina");
    const second = await account(ana, space, "Ahorro");
    expect(await one("accounts", first)).toMatchObject({ is_default: true });
    const spent = await expense(ana, space, member, first);
    const income = ok(await ana.client.rpc("save_income", { p: { space_id: space, member_id: member, amount_cents: 200000, source: "Nómina", received_at: DATE } })) as string;
    ok(await ana.client.rpc("set_movement_account", { p_kind: "income", p_id: income, p_account: first }));
    const fixed = ok(await ana.client.rpc("save_recurring", { p: { space_id: space, description: "Gimnasio", amount_cents: 1000, frequency: "monthly", day: 5, next_run: "2027-01-05", paid_from: "member" } })) as string;
    ok(await ana.client.rpc("set_movement_account", { p_kind: "recurring", p_id: fixed, p_account: first }));
    const fund = (await ana.client.from("funds").select("id").eq("space_id", space).limit(1).single()).data!.id as string;
    ok(await ana.client.rpc("set_fund_account", { p_fund: fund, p_account: first }));
    ok(await ana.client.rpc("create_transfer", { p_from: first, p_to: second, p_amount: 1000, p_date: DATE, p_note: null, p_source: "manual" }));
    ok(await ana.client.rpc("adjust_account_balance", { p_account: first, p_target: 12345, p_note: null }));
    // el mes de esos movimientos está cerrado
    ok(await admin().from("monthly_plans").insert({ space_id: space, month: "2026-11-01", status: "closed" }));

    ok(await ana.client.rpc("delete_account", { p_id: first }));

    expect(await one("accounts", first)).toBeUndefined();
    expect(await one("expenses", spent)).toMatchObject({ account_id: null, account_cents: null, amount_cents: 500 });
    expect(await one("incomes", income)).toMatchObject({ account_id: null, amount_cents: 200000 });
    expect(await one("recurring_expenses", fixed)).toMatchObject({ account_id: null });
    expect(await one("funds", fund)).toMatchObject({ account_id: null });
    expect(await rows("account_transfers", "to_account", second)).toEqual([]);
    expect(await rows("account_adjustments", "account_id", first)).toEqual([]);
    expect(await one("accounts", second)).toMatchObject({ is_default: true }); // hereda el «por defecto»
    const log = (await ana.client.from("audit_log").select("actor, diff").eq("table_name", "accounts").eq("row_id", first)).data!;
    expect(log).toHaveLength(1);
    expect(log[0]!.actor).toBe(ana.id);
    expect(JSON.stringify(log[0]!.diff)).not.toContain("Nómina");
    ok(await admin().from("monthly_plans").delete().eq("space_id", space));
  });

  it("borrar una cuenta propia en un hogar no deja rastro visible para los demás", async () => {
    const { anas } = await home();
    ok(await ana.client.rpc("delete_account", { p_id: anas }));
    expect((await leo.client.from("audit_log").select("id").eq("row_id", anas)).data).toEqual([]);
    expect(await rows("audit_log", "row_id", anas)).toHaveLength(1);
  });

  it("vaciar sin la casilla (como la versión anterior) conserva las cuentas", async () => {
    const { space, anas, leos } = await home();
    ok(await ana.client.rpc("clear_space", { p_space: space }));
    expect(await one("accounts", anas)).toBeDefined();
    ok(await ana.client.rpc("clear_space", { p_space: space, p_delete_accounts: false }));
    expect(await one("accounts", anas)).toBeDefined();
    expect(await one("accounts", leos)).toBeDefined();
  });

  it("vaciar con la casilla borra mis cuentas del espacio y ninguna más", async () => {
    const { space, member, anas, leos } = await home();
    const archived = await account(ana, space, "Antigua");
    ok(await ana.client.rpc("archive_account", { p_id: archived, p_archived: true }));
    const elsewhere = await account(ana, (await personal(ana)).space, "Personal de Ana");
    await expense(ana, space, member, anas);
    // solo quien creó el espacio puede vaciarlo
    expect((await leo.client.rpc("clear_space", { p_space: space, p_delete_accounts: true })).error?.message).toBe("No autorizado");

    const result = ok(await ana.client.rpc("clear_space", { p_space: space, p_delete_accounts: true })) as { others: string[] };

    expect(result.others).toEqual([leo.id]); // a los demás se les avisa como antes
    expect(await one("accounts", anas)).toBeUndefined();
    expect(await one("accounts", archived)).toBeUndefined();
    expect(await one("accounts", leos)).toBeDefined();
    expect(await one("accounts", elsewhere)).toBeDefined();
  });
});
