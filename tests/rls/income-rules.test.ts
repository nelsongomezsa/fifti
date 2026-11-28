import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe.skipIf(!rlsConfigured)("ingresos que se repiten", () => {
  let ana: U, leo: U, eva: U;
  const users: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva");
    users.push(ana.id, leo.id, eva.id);
    // Cambio inventado de hoy y de los días de la prueba, para no depender de la red
    for (let i = -40; i <= 0; i++) await admin().from("fx_rates").upsert({ base: "AUD", quote: "EUR", day: day(i), rate: 0.6 });
  });
  afterAll(async () => { for (const id of users) await admin().auth.admin.deleteUser(id); });

  const ok = <T extends { data: unknown; error: { message: string } | null }>(r: T) => { expect(r.error?.message).toBeUndefined(); return r.data; };
  const rows = async (table: string, column: string, value: string) => (await admin().from(table).select("*").eq(column, value).order(table === "incomes" ? "received_at" : "created_at")).data!;
  const personal = async (u: U) => {
    const space = (await u.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id as string;
    const member = (await u.client.from("space_members").select("id").eq("space_id", space).single()).data!.id as string;
    return { space, member };
  };
  const save = (u: U, space: string, member: string, extra: Record<string, unknown> = {}) =>
    u.client.rpc("save_income_rule", { p: { space_id: space, member_id: member, source: "Cafetería", amount_cents: 65000, currency: "EUR", frequency: "weekly", day: 1, next_run: day(0), ...extra } });

  it("apunta los cobros vencidos en la cuenta elegida y el cron no los duplica", async () => {
    const { space, member } = await personal(ana);
    const account = ok(await ana.client.rpc("save_account", { p: { space_id: space, name: "Australia", kind: "daily", currency: "AUD", opening_cents: 0, opening_date: day(-60) } })) as string;
    const rule = ok(await save(ana, space, member, { next_run: day(-14), currency: "AUD", account_id: account })) as string;

    const first = await rows("incomes", "rule_id", rule);
    expect(first.map((i) => i.received_at)).toEqual([day(-14), day(-7), day(0)]);
    expect(first[0]).toMatchObject({ amount_cents: 39000, currency: "EUR", original_amount_cents: 65000, original_currency: "AUD", account_id: account, account_cents: 65000 });
    ok(await admin().rpc("process_incomes"));
    ok(await admin().rpc("process_incomes"));
    expect(await rows("incomes", "rule_id", rule)).toHaveLength(3);
    expect((await rows("income_rules", "id", rule))[0]!.next_run).toBe(day(7));
    // aunque el próximo cobro volviera atrás, la fecha ya apuntada no se repite
    ok(await admin().from("income_rules").update({ next_run: day(-7) }).eq("id", rule));
    ok(await admin().rpc("process_incomes"));
    expect(await rows("incomes", "rule_id", rule)).toHaveLength(3);
  });

  it("dos veces al mes: el cron apunta cada fecha una sola vez, en ingresos y en gastos fijos", async () => {
    const { space, member } = await personal(eva);
    // el 1 y el 15 desde hace dos meses
    const d = new Date();
    const at = (monthsAgo: number, dayOfMonth: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo, dayOfMonth)).toISOString().slice(0, 10);
    const expected = [at(2, 1), at(2, 15), at(1, 1), at(1, 15), at(0, 1), at(0, 15)].filter((date) => date <= day(0));
    const rule = ok(await save(eva, space, member, { source: "Quincena", frequency: "semimonthly", day: 1, day2: 15, next_run: at(2, 1) })) as string;
    const fixed = ok(await eva.client.rpc("save_recurring", { p: { space_id: space, description: "Seguro", amount_cents: 500, frequency: "semimonthly", day: 1, day2: 15, next_run: at(2, 1), paid_from: "member" } })) as string;
    for (let i = 0; i < 2; i++) { ok(await admin().rpc("process_incomes")); ok(await admin().rpc("process_recurring")); }
    expect((await rows("incomes", "rule_id", rule)).map((i) => i.received_at)).toEqual(expected);
    expect(((await admin().from("expenses").select("spent_at").eq("recurring_id", fixed).order("spent_at")).data ?? []).map((e) => e.spent_at)).toEqual(expected);

    // días que no existen en un mes corto, y combinaciones que no valen
    const next = async (from: string, a: number, b: number) => {
      const r = ok(await save(eva, space, member, { source: `F${a}-${b}-${from}`, frequency: "semimonthly", day: a, day2: b, next_run: from })) as string;
      return (await rows("income_rules", "id", r))[0]!.next_run as string;
    };
    expect(await next(day(30), 15, 31)).toBe(day(30));
    for (const [a, b] of [[15, 15], [28, 30], [20, 10], [1, null]]) {
      expect((await save(eva, space, member, { frequency: "semimonthly", day: a, day2: b, next_run: day(3) })).error?.message).toMatch(/dos días distintos/);
    }
    expect((await eva.client.rpc("save_recurring", { p: { space_id: space, description: "Mal", amount_cents: 1, frequency: "semimonthly", day: 5, next_run: day(3), paid_from: "member" } })).error?.message).toMatch(/dos días distintos/);
    ok(await eva.client.rpc("clear_space", { p_space: space }));
  });

  it("saltar un cobro: no se apunta y se puede recuperar antes de que llegue", async () => {
    const { space, member } = await personal(leo);
    const rule = ok(await save(leo, space, member, { next_run: day(7), frequency: "biweekly" })) as string;
    ok(await leo.client.rpc("set_income_skip", { p_rule: rule, p_date: day(7), p_skip: true }));
    ok(await leo.client.rpc("set_income_skip", { p_rule: rule, p_date: day(7), p_skip: false }));
    ok(await leo.client.rpc("set_income_skip", { p_rule: rule, p_date: day(7), p_skip: true }));
    expect((await leo.client.rpc("set_income_skip", { p_rule: rule, p_date: day(-1), p_skip: true })).error?.message).toBe("Esa fecha ya pasó");
    // llega el día: se mueve la regla una semana atrás junto con lo saltado
    ok(await admin().from("income_rules").update({ next_run: day(0) }).eq("id", rule));
    ok(await admin().from("income_skips").update({ skip_on: day(0) }).eq("rule_id", rule));
    ok(await admin().rpc("process_incomes"));
    expect(await rows("incomes", "rule_id", rule)).toEqual([]);
    expect((await rows("income_rules", "id", rule))[0]!.next_run).toBe(day(14));
  });

  it("solo la persona puede crearla, tocarla o borrarla; fuera del espacio no se ve", async () => {
    const { space, member } = await personal(ana);
    const rule = ok(await save(ana, space, member, { next_run: day(3), source: "Privado" })) as string;
    const guest = await createGuest();
    users.push(guest.id);
    for (const u of [eva, guest] as U[]) {
      expect((await save(u, space, member)).error?.message).toBe("No autorizado");
      expect((await u.client.rpc("set_income_rule_active", { p_id: rule, p_active: false })).error?.message).toBe("No autorizado");
      expect((await u.client.rpc("set_income_skip", { p_rule: rule, p_date: day(3), p_skip: true })).error?.message).toBe("No autorizado");
      expect((await u.client.rpc("delete_income_rule", { p_id: rule })).error?.message).toBe("No autorizado");
      expect((await u.client.from("income_rules").select("id").eq("id", rule)).data).toEqual([]);
    }
    for (const attempt of [ana.client.from("income_rules").update({ amount_cents: 1 }).eq("id", rule), ana.client.from("income_rules").delete().eq("id", rule)]) {
      expect((await attempt).error).not.toBeNull();
    }
    expect((await ana.client.rpc("process_incomes")).error).not.toBeNull(); // solo el cron
    // no se puede cobrar en la cuenta de otra persona
    const other = await personal(eva);
    const evas = ok(await eva.client.rpc("save_account", { p: { space_id: other.space, name: "De Eva", kind: "daily", opening_cents: 0, opening_date: day(0) } })) as string;
    expect((await save(ana, space, member, { account_id: evas })).error?.message).toBe("No autorizado");
  });

  it("en un hogar, otra persona no cambia mis ingresos; si me voy, quedan en pausa", async () => {
    const space = ok(await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household" })) as string;
    const token = newToken();
    ok(await ana.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: await sha256(token), p_ttl_seconds: 3600, p_max_uses: 1 }));
    ok(await leo.client.rpc("accept_invite", { p_token_hash: await sha256(token) }));
    const leoM = (await admin().from("space_members").select("id").eq("space_id", space).eq("user_id", leo.id).single()).data!.id as string;
    const rule = ok(await save(leo, space, leoM, { next_run: day(3) })) as string;
    expect((await save(ana, space, leoM)).error?.message).toBe("No autorizado");
    expect((await ana.client.rpc("delete_income_rule", { p_id: rule })).error?.message).toBe("No autorizado");
    ok(await leo.client.rpc("leave_space", { p_space: space }));
    expect((await rows("income_rules", "id", rule))[0]).toMatchObject({ active: false, account_id: null });
  });

  it("pausar no recupera lo atrasado; borrar la regla conserva los cobros y vaciar el espacio se la lleva", async () => {
    const { space, member } = await personal(eva);
    const rule = ok(await save(eva, space, member, { next_run: day(0) })) as string;
    ok(await eva.client.rpc("set_income_rule_active", { p_id: rule, p_active: false }));
    ok(await admin().from("income_rules").update({ next_run: day(-21) }).eq("id", rule));
    ok(await admin().rpc("process_incomes"));
    ok(await eva.client.rpc("set_income_rule_active", { p_id: rule, p_active: true }));
    expect(await rows("incomes", "rule_id", rule)).toHaveLength(1); // el de hoy ya estaba; los de la pausa no vuelven
    const income = (await rows("incomes", "rule_id", rule))[0]!.id as string;
    ok(await eva.client.rpc("delete_income_rule", { p_id: rule }));
    expect((await rows("incomes", "id", income))[0]).toMatchObject({ rule_id: null });

    const other = ok(await save(eva, space, member, { next_run: day(5) })) as string;
    ok(await eva.client.rpc("clear_space", { p_space: space }));
    expect(await rows("income_rules", "id", other)).toEqual([]);
  });

  it("un ingreso en otra moneda se guarda convertido, con lo que se escribió, y se puede editar", async () => {
    const { space, member } = await personal(ana);
    const id = ok(await ana.client.rpc("save_income", { p: { space_id: space, member_id: member, amount_cents: 10000, currency: "AUD", source: "Propina", received_at: day(0) } })) as string;
    expect((await rows("incomes", "id", id))[0]).toMatchObject({ amount_cents: 6000, original_amount_cents: 10000, original_currency: "AUD", currency: "EUR" });
    ok(await ana.client.rpc("save_income", { p: { id, space_id: space, member_id: member, amount_cents: 20000, currency: "AUD", source: "Propina", received_at: day(0) } }));
    expect((await rows("incomes", "id", id))[0]).toMatchObject({ amount_cents: 12000, original_amount_cents: 20000 });
    ok(await ana.client.rpc("save_income", { p: { id, space_id: space, member_id: member, amount_cents: 500, source: "Propina", received_at: day(0) } }));
    expect((await rows("incomes", "id", id))[0]).toMatchObject({ amount_cents: 500, original_amount_cents: null, original_currency: null });
  });

  it("un cobro ya apuntado puede pasar a ser el primero de una serie sin duplicarse", async () => {
    const { space, member } = await personal(leo);
    const id = ok(await leo.client.rpc("save_income", { p: { space_id: space, member_id: member, amount_cents: 1000, source: "Clases", received_at: day(0) } })) as string;
    const rule = ok(await save(leo, space, member, { source: "Clases", from_income: id, next_run: day(0), frequency: "weekly" })) as string;
    expect((await rows("incomes", "rule_id", rule)).map((i) => i.id)).toEqual([id]);
    expect((await rows("income_rules", "id", rule))[0]!.next_run).toBe(day(7));
  });
});
