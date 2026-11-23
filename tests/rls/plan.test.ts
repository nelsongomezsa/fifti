import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS fase 6: plan, aportaciones y fijos", () => {
  let ana: U, leo: U, eva: U;
  let hogar: string, anaH: string, leoH: string, anaPersonal: string;
  const toDelete: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva");
    toDelete.push(ana.id, leo.id, eva.id);
    hogar = (await ana.client.rpc("create_space", { p_name: "Casa", p_kind: "household" })).data as string;
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: hogar, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 3 });
    await leo.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
    const { data } = await ana.client.from("space_members").select("id, user_id").eq("space_id", hogar);
    anaH = data!.find((m) => m.user_id === ana.id)!.id; leoH = data!.find((m) => m.user_id === leo.id)!.id;
    anaPersonal = (await ana.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  const plan = (space: string, over: Record<string, unknown> = {}) => ({
    space_id: space, month: "2026-11-01", notes: "Mes tranquilo", incomes: [{ member_id: anaH, expected_cents: 200000 }, { member_id: leoH, expected_cents: 100000 }],
    allocations: [], ...over,
  });

  it("un extraño no ve ni crea planes del hogar", async () => {
    expect((await ana.client.rpc("save_plan", { p: plan(hogar) })).error).toBeNull();
    expect((await eva.client.from("monthly_plans").select("id").eq("space_id", hogar)).data).toEqual([]);
    expect((await eva.client.rpc("save_plan", { p: plan(hogar, { month: "2026-12-01" }) })).error).not.toBeNull();
  });

  it("valida mes, % (≤100), fondos y miembros del propio espacio", async () => {
    expect((await ana.client.rpc("save_plan", { p: plan(hogar, { month: "2026-11-15" }) })).error).not.toBeNull();
    const funds = (await ana.client.from("funds").select("id").eq("space_id", hogar)).data!;
    const over = funds.slice(0, 2).map((f) => ({ fund_id: f.id, mode: "percent", value: 6000, planned_cents: 1 }));
    expect((await ana.client.rpc("save_plan", { p: plan(hogar, { allocations: over }) })).error).not.toBeNull();
    const foreign = (await ana.client.from("funds").select("id").eq("space_id", anaPersonal).limit(1)).data![0]!.id;
    expect((await ana.client.rpc("save_plan", { p: plan(hogar, { allocations: [{ fund_id: foreign, mode: "amount", value: 1, planned_cents: 1 }] }) })).error).not.toBeNull();
  });

  it("copiar plan: solo del mes anterior existente y no sobre uno existente", async () => {
    expect((await ana.client.rpc("copy_plan", { p_space: hogar, p_from: "2026-11-01", p_to: "2026-12-01" })).error).toBeNull();
    expect((await ana.client.rpc("copy_plan", { p_space: hogar, p_from: "2026-11-01", p_to: "2026-12-01" })).error).not.toBeNull();
    expect((await eva.client.rpc("copy_plan", { p_space: hogar, p_from: "2026-11-01", p_to: "2027-01-01" })).error).not.toBeNull();
  });

  it("la regla de aportación solo la fija el owner; los invitados no tocan el plan", async () => {
    expect((await leo.client.rpc("save_contribution_rule", { p_space: hogar, p_mode: "proportional_to_income", p_target: 100000, p_values: {} })).error).not.toBeNull();
    expect((await ana.client.rpc("save_contribution_rule", { p_space: hogar, p_mode: "proportional_to_income", p_target: 100000, p_values: {} })).error).toBeNull();
    const guest = await createGuest(); toDelete.push(guest.id);
    expect((await guest.client.rpc("save_plan", { p: plan(hogar, { month: "2027-02-01" }) })).error).not.toBeNull();
  });

  it("aportación hecha: crea el gasto en el plan PERSONAL de quien aporta; desmarcar lo borra", async () => {
    await ana.client.rpc("save_contributions", { p_space: hogar, p_month: "2026-11-01", p_lines: [{ member_id: anaH, expected_cents: 75000 }, { member_id: leoH, expected_cents: 25000 }] });
    const { data: cs } = await ana.client.from("contributions").select("id, member_id").eq("space_id", hogar).eq("month", "2026-11-01");
    const mine = cs!.find((c) => c.member_id === anaH)!;
    // Leo y un extraño no pueden marcar la aportación de Ana
    expect((await leo.client.rpc("mark_contribution_paid", { p_id: mine.id, p_paid: 75000 })).error).not.toBeNull();
    expect((await eva.client.rpc("mark_contribution_paid", { p_id: mine.id, p_paid: 75000 })).error).not.toBeNull();
    expect((await ana.client.rpc("mark_contribution_paid", { p_id: mine.id, p_paid: 75000 })).error).toBeNull();
    const { data: ex } = await ana.client.from("expenses").select("id, amount_cents, description").eq("space_id", anaPersonal);
    expect(ex!.some((e) => e.amount_cents === 75000 && e.description.startsWith("Aportación a"))).toBe(true);
    // Leo no ve el gasto personal de Ana
    expect((await leo.client.from("expenses").select("id").eq("space_id", anaPersonal)).data).toEqual([]);
    expect((await ana.client.rpc("mark_contribution_paid", { p_id: mine.id, p_paid: 0 })).error).toBeNull();
    expect((await ana.client.from("expenses").select("amount_cents").eq("space_id", anaPersonal).eq("amount_cents", 75000)).data).toEqual([]);
  });

  it("gastos fijos: solo miembros completos, categorías del espacio, bote solo en hogares", async () => {
    const rec = { space_id: hogar, description: "Alquiler", amount_cents: 65000, frequency: "monthly", day: 1, next_run: "2026-12-01", paid_from: "member" };
    expect((await ana.client.rpc("save_recurring", { p: rec })).error).toBeNull();
    expect((await eva.client.rpc("save_recurring", { p: rec })).error).not.toBeNull();
    const foreignCat = (await ana.client.from("categories").select("id").eq("space_id", anaPersonal).limit(1)).data![0]!.id;
    expect((await ana.client.rpc("save_recurring", { p: { ...rec, category_id: foreignCat } })).error).not.toBeNull();
    expect((await eva.client.from("recurring_expenses").select("id").eq("space_id", hogar)).data).toEqual([]);
    expect((await ana.client.rpc("save_recurring", { p: { ...rec, space_id: anaPersonal, paid_from: "pot" } })).error).not.toBeNull();
  });

  it("process_recurring solo lo ejecuta service_role y genera gastos con reparto que suma el total", async () => {
    expect((await ana.client.rpc("process_recurring")).error).not.toBeNull();
    await admin().from("recurring_expenses").update({ next_run: "2026-01-01" }).eq("space_id", hogar);
    const { data: n, error } = await admin().rpc("process_recurring");
    expect(error).toBeNull();
    expect(n as number).toBeGreaterThan(0);
    const { data: exps } = await ana.client.from("expenses").select("id, amount_cents, expense_splits(amount_cents)").eq("space_id", hogar).not("recurring_id", "is", null);
    for (const e of exps!) expect((e.expense_splits as { amount_cents: number }[]).reduce((a, b) => a + b.amount_cents, 0)).toBe(e.amount_cents);
  });
});
