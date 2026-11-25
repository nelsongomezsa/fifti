import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS: cuentas, traspasos y saldos", () => {
  let ana: U, leo: U, eva: U;
  let anaP: string, anaPm: string, hogar: string;
  let nomina: string, revolut: string, comun: string;
  const toDelete: string[] = [];
  const today = () => new Date().toISOString().slice(0, 10);

  async function join(owner: U, space: string, user: U) {
    const t = newToken();
    await owner.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 5 });
    await user.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
  }
  const balance = async (u: U, id: string) => ((await u.client.rpc("account_balances")).data as { account_id: string; balance_cents: number }[]).find((b) => b.account_id === id)?.balance_cents;
  const exp = (space: string, member: string, cents: number, over: Record<string, unknown> = {}) => ({
    client_id: crypto.randomUUID(), space_id: space, description: "Compra", spent_at: today(), amount_cents: cents, currency: "EUR", fx_rate: 1, amount_base_cents: cents,
    paid_from: "member", split_mode: "equal", is_private: false, tags: [],
    payers: [{ member_id: member, amount_cents: cents }], splits: [{ member_id: member, share_bp: 10000, amount_cents: cents }], ...over,
  });

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva"); toDelete.push(ana.id, leo.id, eva.id);
    anaP = (await ana.client.from("spaces").select("id").eq("kind", "personal")).data![0]!.id;
    anaPm = (await ana.client.from("space_members").select("id").eq("space_id", anaP)).data![0]!.id;
    hogar = (await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household" })).data as string;
    await join(ana, hogar, leo);
    nomina = (await ana.client.rpc("save_account", { p: { space_id: anaP, name: "Santander nómina", bank: "Santander", color: "#EC0000", kind: "payroll", opening_cents: 100000, opening_date: today() } })).data as string;
    revolut = (await ana.client.rpc("save_account", { p: { space_id: anaP, name: "Revolut día a día", bank: "Revolut", kind: "daily", opening_cents: 0 } })).data as string;
    comun = (await ana.client.rpc("save_account", { p: { space_id: hogar, name: "Cuenta común", kind: "shared", opening_cents: 0 } })).data as string;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("cada persona ve sus cuentas; las comunes las ven los miembros del hogar; nadie escribe directo", async () => {
    expect((await ana.client.from("accounts").select("id")).data!.map((a) => a.id).sort()).toEqual([nomina, revolut, comun].sort());
    expect((await leo.client.from("accounts").select("id")).data!.map((a) => a.id)).toEqual([comun]); // solo la común
    expect((await eva.client.from("accounts").select("id")).data).toEqual([]);
    expect((await leo.client.from("accounts").insert({ space_id: hogar, name: "Mía", owner_user_id: leo.id }).select()).error).not.toBeNull();
    expect((await ana.client.from("accounts").update({ name: "X" }).eq("id", nomina).select()).data ?? []).toEqual([]);
    expect((await ana.client.from("accounts").delete().eq("id", nomina).select()).data ?? []).toEqual([]);
  });

  it("la primera cuenta de un espacio es la de por defecto; una común no cabe en Personal; no se editan cuentas ajenas", async () => {
    expect((await ana.client.from("accounts").select("id, is_default").eq("space_id", anaP).order("created_at")).data).toEqual([{ id: nomina, is_default: true }, { id: revolut, is_default: false }]);
    expect((await ana.client.rpc("save_account", { p: { space_id: anaP, name: "Mala", kind: "shared" } })).error).not.toBeNull();
    expect((await leo.client.rpc("save_account", { p: { id: nomina, name: "Robada", kind: "daily" } })).error).not.toBeNull();
    expect((await eva.client.rpc("save_account", { p: { space_id: hogar, name: "Intrusa", kind: "shared" } })).error).not.toBeNull();
    expect((await leo.client.rpc("archive_account", { p_id: nomina, p_archived: true })).error).not.toBeNull();
  });

  it("el gasto y el ingreso nuevos toman la cuenta por defecto y el saldo = inicial + ingresos − gastos", async () => {
    const e = (await ana.client.rpc("save_expense", { p: exp(anaP, anaPm, 20000) })).data as string;
    await ana.client.rpc("save_income", { p: { space_id: anaP, member_id: anaPm, amount_cents: 50000, source: "Nómina", received_at: today() } });
    expect((await admin().from("expenses").select("account_id").eq("id", e)).data![0]!.account_id).toBe(nomina);
    expect(await balance(ana, nomina)).toBe(100000 + 50000 - 20000);
  });

  it("cambiar la cuenta de un movimiento: solo su autor y solo con una cuenta de ese espacio", async () => {
    const e = (await ana.client.rpc("save_expense", { p: exp(anaP, anaPm, 1000) })).data as string;
    expect((await ana.client.rpc("set_movement_account", { p_kind: "expense", p_id: e, p_account: revolut })).error).toBeNull();
    expect((await admin().from("expenses").select("account_id").eq("id", e)).data![0]!.account_id).toBe(revolut);
    expect((await leo.client.rpc("set_movement_account", { p_kind: "expense", p_id: e, p_account: comun })).error).not.toBeNull();
    expect((await ana.client.rpc("set_movement_account", { p_kind: "expense", p_id: e, p_account: comun })).error).not.toBeNull(); // la común es de otro espacio
    expect((await ana.client.rpc("set_movement_account", { p_kind: "expense", p_id: e, p_account: null })).error).toBeNull();
  });

  it("un traspaso mueve saldo, no es gasto ni ingreso, y solo se saca de cuentas propias", async () => {
    const before = (await admin().from("expenses").select("id", { count: "exact", head: true }).eq("space_id", anaP)).count;
    const nBefore = (await balance(ana, nomina))!;
    const t = await ana.client.rpc("create_transfer", { p_from: nomina, p_to: revolut, p_amount: 30000, p_date: today(), p_note: "Día a día", p_source: "payroll_split" });
    expect(t.error).toBeNull();
    expect(await balance(ana, nomina)).toBe(nBefore - 30000);
    expect(await balance(ana, revolut)).toBe(30000 - 1000 * 0 - (await admin().from("expenses").select("amount_base_cents").eq("account_id", revolut)).data!.reduce((a, r) => a + r.amount_base_cents, 0));
    expect((await admin().from("expenses").select("id", { count: "exact", head: true }).eq("space_id", anaP)).count).toBe(before);
    expect((await leo.client.rpc("create_transfer", { p_from: nomina, p_to: comun, p_amount: 100, p_date: today(), p_note: null, p_source: "manual" })).error).not.toBeNull();
    expect((await ana.client.rpc("create_transfer", { p_from: nomina, p_to: nomina, p_amount: 100, p_date: today(), p_note: null, p_source: "manual" })).error).not.toBeNull();
    expect((await ana.client.rpc("create_transfer", { p_from: nomina, p_to: revolut, p_amount: 0, p_date: today(), p_note: null, p_source: "manual" })).error).not.toBeNull();
    expect((await eva.client.from("account_transfers").select("id")).data).toEqual([]);
    expect((await leo.client.rpc("delete_transfer", { p_id: t.data as string })).error).not.toBeNull();
  });

  it("un traspaso a la cuenta común del hogar es una aportación, contada una sola vez", async () => {
    const nBefore = (await balance(ana, nomina))!;
    expect((await ana.client.rpc("create_transfer", { p_from: nomina, p_to: comun, p_amount: 25000, p_date: today(), p_note: null, p_source: "manual" })).error).toBeNull();
    expect(await balance(ana, nomina)).toBe(nBefore - 25000); // una sola salida de saldo
    expect(await balance(leo, comun)).toBe(25000); // Leo ve entrar el dinero en la común
    const aportes = (await admin().from("expenses").select("amount_cents, account_id").eq("space_id", anaP).like("description", "Aportación a%")).data!;
    expect(aportes).toEqual([{ amount_cents: 25000, account_id: null }]); // sale en Personal, sin cuenta propia
    expect((await ana.client.from("contributions").select("paid_cents").eq("space_id", hogar)).data).toEqual([{ paid_cents: 25000 }]);
  });

  it("ajustar el saldo crea un ajuste visible y deja el saldo en lo pedido; no se ajustan cuentas ajenas", async () => {
    const r = await ana.client.rpc("adjust_account_balance", { p_account: revolut, p_target: 12345, p_note: "Según el banco" });
    expect(r.error).toBeNull();
    expect(await balance(ana, revolut)).toBe(12345);
    expect((await ana.client.from("account_adjustments").select("note").eq("account_id", revolut)).data).toEqual([{ note: "Según el banco" }]);
    expect((await leo.client.rpc("adjust_account_balance", { p_account: nomina, p_target: 1, p_note: null })).error).not.toBeNull();
    expect((await leo.client.from("account_adjustments").select("id")).data).toEqual([]);
  });

  it("la cuenta de una partida solo puede ser una cuenta propia y solo la fija el dueño del espacio", async () => {
    const fund = (await ana.client.from("funds").select("id").eq("space_id", anaP).limit(1)).data![0]!.id;
    expect((await ana.client.rpc("set_fund_account", { p_fund: fund, p_account: revolut })).error).toBeNull();
    expect((await leo.client.rpc("set_fund_account", { p_fund: fund, p_account: comun })).error).not.toBeNull();
    expect((await ana.client.rpc("set_fund_account", { p_fund: fund, p_account: comun })).error).toBeNull(); // la común es suya (la creó)
  });
});
