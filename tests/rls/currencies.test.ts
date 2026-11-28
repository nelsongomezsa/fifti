import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

// Cambios inventados y fijos: el cambio de moneda solo lee la caché, así que no hay red.
const DATE = "2026-11-10";
const today = new Date().toISOString().slice(0, 10);
const RATES: [string, string, string, number][] = [
  [DATE, "EUR", "AUD", 1.6], [today, "EUR", "AUD", 1.7], [DATE, "AUD", "EUR", 0.625], [today, "AUD", "EUR", 0.6],
  [DATE, "USD", "AUD", 1.5], [DATE, "USD", "EUR", 0.9],
];

describe.skipIf(!rlsConfigured)("varias monedas: cambio de moneda, cuentas, traspasos y reflejos", () => {
  let ana: U, leo: U, eva: U;
  let personal: string, anaM: string, funds: { id: string; kind: string }[];
  const users: string[] = [];

  beforeAll(async () => {
    const seeded = await admin().from("fx_rates").upsert(RATES.map(([day, base, quote, rate]) => ({ day, base, quote, rate })));
    if (seeded.error) throw seeded.error;
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva");
    users.push(ana.id, leo.id, eva.id);
    personal = (await ana.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id;
    anaM = (await ana.client.from("space_members").select("id").eq("space_id", personal).single()).data!.id;
    funds = (await ana.client.from("funds").select("id, kind").eq("space_id", personal)).data!;
  });
  afterAll(async () => { for (const id of users) await admin().auth.admin.deleteUser(id); });

  const ok = <T extends { data: unknown; error: { message: string } | null }>(r: T) => { expect(r.error?.message).toBeUndefined(); return r.data; };
  const expense = (u: U, space: string, payer: string, splits: [string, number][], cents: number, currency = "EUR", fx = 1) => {
    const base = Math.round(cents * fx);
    const parts = splits.map(([m, share]) => [m, Math.floor((base * share) / 10000), share] as const);
    const rest = base - parts.reduce((a, p) => a + p[1], 0);
    return u.client.rpc("save_expense", { p: {
      client_id: crypto.randomUUID(), space_id: space, description: "Viernes noche", spent_at: DATE, amount_cents: cents, currency, fx_rate: fx, amount_base_cents: base,
      paid_from: "member", split_mode: "custom", is_private: false, tags: [], payers: [{ member_id: payer, amount_cents: base }],
      splits: parts.map(([m, c, share], i) => ({ member_id: m, share_bp: share, amount_cents: c + (i === 0 ? rest : 0) })),
    } });
  };
  const row = async (table: string, id: string) => (await admin().from(table).select("*").eq("id", id).single()).data!;
  const balance = async (u: U, account: string) => Number(((await u.client.rpc("account_balances")).data as { account_id: string; balance_cents: number }[]).find((a) => a.account_id === account)!.balance_cents);
  const change = (u: U, space: string, currency: string) => u.client.rpc("change_space_currency", { p_space_id: space, p_currency: currency });

  async function shared(kind: "group" | "household", currency = "EUR") {
    const space = ok(await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: kind, p_currency: currency })) as string;
    const token = newToken();
    ok(await ana.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: await sha256(token), p_ttl_seconds: 3600, p_max_uses: 2 }));
    ok(await leo.client.rpc("accept_invite", { p_token_hash: await sha256(token) }));
    const members = (await ana.client.from("space_members").select("id, user_id").eq("space_id", space)).data!;
    return { space, a: members.find((m) => m.user_id === ana.id)!.id as string, l: members.find((m) => m.user_id === leo.id)!.id as string };
  }

  it("Personal EUR → AUD: los gastos conservan su importe; el presupuesto y los ingresos se recalculan; las cuentas no se mueven", async () => {
    const account = ok(await ana.client.rpc("save_account", { p: { space_id: personal, name: "Cuenta española", kind: "daily", opening_cents: 100000, opening_date: "2026-11-01" } })) as string;
    expect((await row("accounts", account)).currency).toBe("EUR");
    const eur = ok(await expense(ana, personal, anaM, [[anaM, 10000]], 1000)) as string;
    const usd = ok(await expense(ana, personal, anaM, [[anaM, 10000]], 2000, "USD", 0.9)) as string;
    const income = ok(await ana.client.rpc("save_income", { p: { space_id: personal, member_id: anaM, amount_cents: 200000, source: "Nómina", received_at: DATE } })) as string;
    const variable = funds.find((f) => f.kind === "variable")!.id, savings = funds.find((f) => f.kind === "savings")!.id;
    ok(await ana.client.rpc("save_plan", { p: { space_id: personal, month: "2026-11-01", incomes: [{ member_id: anaM, expected_cents: 200000 }], allocations: [
      { fund_id: variable, mode: "amount", value: 50000, planned_cents: 50000 }, { fund_id: savings, mode: "percent", value: 2000, planned_cents: 40000 }] } }));
    const rec = ok(await ana.client.rpc("save_recurring", { p: { space_id: personal, description: "Gimnasio", amount_cents: 1000, frequency: "monthly", day: 5, next_run: today, paid_from: "member" } })) as string;
    const before = await balance(ana, account);
    expect(before).toBe(100000 - 1000 - 1800 + 200000);

    ok(await change(ana, personal, "AUD"));

    expect(await row("spaces", personal)).toMatchObject({ base_currency: "AUD" });
    expect(await row("expenses", eur)).toMatchObject({ amount_cents: 1000, currency: "EUR", amount_base_cents: 1600 });
    expect(Number((await row("expenses", eur)).fx_rate)).toBe(1.6);
    expect(await row("expenses", usd)).toMatchObject({ amount_cents: 2000, currency: "USD", amount_base_cents: 3000 });
    for (const id of [eur, usd]) {
      const e = await row("expenses", id);
      for (const table of ["expense_splits", "expense_payers"]) {
        const { data } = await admin().from(table).select("amount_cents").eq("expense_id", id);
        expect(data!.reduce((a, r) => a + r.amount_cents, 0)).toBe(e.amount_base_cents);
      }
    }
    expect(await row("incomes", income)).toMatchObject({ amount_cents: 320000, currency: "AUD", original_amount_cents: 200000, original_currency: "EUR" });
    const { data: alloc } = await ana.client.from("plan_allocations").select("fund_id, mode, value, planned_cents");
    expect(alloc!.find((a) => a.fund_id === variable)).toMatchObject({ value: 85000, planned_cents: 85000 });
    expect(alloc!.find((a) => a.fund_id === savings)).toMatchObject({ mode: "percent", value: 2000, planned_cents: 68000 }); // el porcentaje se mantiene
    expect((await ana.client.from("plan_incomes").select("expected_cents").single()).data).toEqual({ expected_cents: 340000 });
    expect(await row("recurring_expenses", rec)).toMatchObject({ amount_cents: 1700 });
    expect(await balance(ana, account)).toBe(before);
    const log = (await ana.client.from("audit_log").select("actor, diff").eq("table_name", "spaces").eq("row_id", personal)).data!;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor: ana.id, diff: { old: { base_currency: "EUR" }, new: { base_currency: "AUD" } } });

    // Volver atrás: los gastos e ingresos salen del original, sin acumular redondeos
    ok(await change(ana, personal, "EUR"));
    expect(await row("expenses", eur)).toMatchObject({ amount_base_cents: 1000 });
    expect(await row("expenses", usd)).toMatchObject({ amount_base_cents: 1800 });
    expect(await row("incomes", income)).toMatchObject({ amount_cents: 200000, currency: "EUR", original_amount_cents: null, original_currency: null });
    expect(await balance(ana, account)).toBe(before);
  });

  it("grupo: solo el propietario cambia la moneda y los saldos siguen sumando cero", async () => {
    const { space, a, l } = await shared("group");
    const id = ok(await expense(ana, space, a, [[a, 3333], [l, 6667]], 1001)) as string;

    expect((await change(leo, space, "AUD")).error?.message).toBe("No autorizado");
    expect((await change(eva, space, "AUD")).error?.message).toBe("No autorizado");
    expect((await change(ana, space, "XXX")).error?.message).toBe("Moneda no válida");
    expect((await ana.client.from("spaces").update({ base_currency: "AUD" }).eq("id", space)).error).not.toBeNull(); // solo por la función
    expect((await leo.client.from("accounts").update({ currency: "AUD" }).neq("name", "")).error).not.toBeNull();
    expect((await ana.client.rpc("currency_change_needs", { p_space: space, p_currency: "AUD" })).error).not.toBeNull();
    expect((await row("spaces", space)).base_currency).toBe("EUR");

    ok(await ana.client.rpc("record_settlement", { p_space: space, p_from: l, p_to: a, p_amount: 100, p_method: "cash", p_note: null, p_date: DATE }));
    ok(await change(ana, space, "AUD"));
    const e = await row("expenses", id);
    expect(e).toMatchObject({ amount_cents: 1001, currency: "EUR", amount_base_cents: 1602 });
    const splits = (await admin().from("expense_splits").select("amount_cents").eq("expense_id", id)).data!;
    expect(splits.reduce((s, r) => s + r.amount_cents, 0)).toBe(1602);
    expect((await ana.client.from("settlements").select("amount_cents").eq("space_id", space).single()).data).toEqual({ amount_cents: 160 });
    // la parte de Leo en su Personal (EUR) vuelve a convertirse desde dólares australianos
    const mirror = (await leo.client.from("personal_mirror").select("amount_cents").eq("source_expense_id", id).single()).data!;
    const leoShare = (await admin().from("expense_splits").select("amount_cents").eq("expense_id", id).eq("member_id", l).single()).data!.amount_cents;
    expect(mirror.amount_cents).toBe(Math.round(leoShare * 0.625));
  });

  it("si falta algún cambio no se toca nada", async () => {
    const { space, a } = await shared("group");
    const id = ok(await expense(ana, space, a, [[a, 10000]], 500)) as string;
    ok(await admin().from("expenses").update({ spent_at: "2001-01-02" }).eq("id", id));
    expect((await change(ana, space, "AUD")).error?.message).toContain("Falta algún tipo de cambio");
    expect((await row("spaces", space)).base_currency).toBe("EUR");
    expect(await row("expenses", id)).toMatchObject({ amount_base_cents: 500 });
  });

  it("traspaso entre cuentas de monedas distintas: exige lo que llega y cada saldo va en su moneda", async () => {
    const eur = ok(await eva.client.rpc("save_account", { p: { space_id: (await eva.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id, name: "España", kind: "daily", opening_cents: 100000, opening_date: DATE } })) as string;
    const space = (await row("accounts", eur)).space_id as string;
    const aud = ok(await eva.client.rpc("save_account", { p: { space_id: space, name: "Australia", kind: "daily", currency: "AUD", opening_cents: 0, opening_date: DATE } })) as string;
    const args = { p_from: eur, p_to: aud, p_amount: 10000, p_date: DATE, p_note: null, p_source: "manual" };
    expect((await eva.client.rpc("create_transfer", args)).error?.message).toBe("Pon el importe que llega");
    ok(await eva.client.rpc("create_transfer", { ...args, p_to_amount: 15800 }));
    expect(await balance(eva, eur)).toBe(90000);
    expect(await balance(eva, aud)).toBe(15800);
    // con movimientos ya no se puede cambiar su moneda, y no vale cualquier código
    expect((await eva.client.rpc("save_account", { p: { id: aud, space_id: space, name: "Australia", kind: "daily", currency: "USD" } })).error?.message).toContain("con movimientos");
    expect((await eva.client.rpc("save_account", { p: { space_id: space, name: "Mala", kind: "daily", currency: "XXX" } })).error?.message).toBe("Moneda no válida");
    // un gasto en EUR pagado desde la cuenta en AUD resta dólares australianos
    const me = (await eva.client.from("space_members").select("id").eq("space_id", space).single()).data!.id;
    const id = ok(await expense(eva, space, me, [[me, 10000]], 1000)) as string;
    ok(await eva.client.rpc("set_movement_account", { p_kind: "expense", p_id: id, p_account: aud }));
    expect(await balance(eva, aud)).toBe(15800 - 1600);
  });
});
