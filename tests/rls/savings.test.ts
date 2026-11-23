import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS fase 8: ahorro", () => {
  let ana: U, leo: U, eva: U;
  let hogar: string, anaPersonal: string, anaP: string, goalH: string, goalP: string;
  const toDelete: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva"); toDelete.push(ana.id, leo.id, eva.id);
    hogar = (await ana.client.rpc("create_space", { p_name: "Casa", p_kind: "household" })).data as string;
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: hogar, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 2 });
    await leo.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
    anaPersonal = (await ana.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id;
    anaP = (await ana.client.from("space_members").select("id").eq("space_id", anaPersonal).single()).data!.id;
    goalH = (await ana.client.from("savings_goals").insert({ space_id: hogar, name: "Viaje", target_cents: 100000 }).select("id").single()).data!.id;
    goalP = (await ana.client.from("savings_goals").insert({ space_id: anaPersonal, name: "Colchón", target_cents: 500000 }).select("id").single()).data!.id;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("las metas son del espacio: un extraño no las ve ni las crea", async () => {
    expect((await eva.client.from("savings_goals").select("id").eq("id", goalH)).data).toEqual([]);
    expect((await eva.client.from("savings_goals").insert({ space_id: hogar, name: "Intruso", target_cents: 1 })).error).not.toBeNull();
    expect((await leo.client.from("savings_goals").select("id").eq("id", goalP)).data).toEqual([]); // la personal de Ana es privada
    expect((await leo.client.from("savings_goals").select("id").eq("id", goalH)).data).toHaveLength(1);
  });

  it("aportaciones manuales: solo miembros completos, como uno mismo, importes válidos", async () => {
    expect((await leo.client.rpc("add_goal_contribution", { p_goal: goalH, p_amount: 5000, p_source: "manual", p_date: null })).error).toBeNull();
    expect((await eva.client.rpc("add_goal_contribution", { p_goal: goalH, p_amount: 5000, p_source: "manual", p_date: null })).error).not.toBeNull();
    expect((await ana.client.rpc("add_goal_contribution", { p_goal: goalH, p_amount: 0, p_source: "manual", p_date: null })).error).not.toBeNull();
    expect((await ana.client.rpc("add_goal_contribution", { p_goal: goalH, p_amount: 100, p_source: "income_rule", p_date: null })).error).not.toBeNull();
    expect((await ana.client.from("goal_contributions").insert({ goal_id: goalH, space_id: hogar, member_id: anaP, amount_cents: 1, source: "manual" })).error).not.toBeNull();
    const guest = await createGuest(); toDelete.push(guest.id);
    expect((await guest.client.rpc("add_goal_contribution", { p_goal: goalH, p_amount: 100, p_source: "manual", p_date: null })).error).not.toBeNull();
  });

  it("solo el autor borra su aportación manual; las automáticas no se borran a mano", async () => {
    const { data: id } = await leo.client.rpc("add_goal_contribution", { p_goal: goalH, p_amount: 700, p_source: "manual", p_date: null });
    expect((await eva.client.rpc("delete_goal_contribution", { p_id: id as string })).error).not.toBeNull();
    expect((await leo.client.rpc("delete_goal_contribution", { p_id: id as string })).error).toBeNull();
  });

  it("regla de redondeo: gasto personal de 12,34 € aporta 0,66 €; editar el importe recalcula; borrar lo quita", async () => {
    await ana.client.from("saving_rules").insert({ space_id: anaPersonal, goal_id: goalP, kind: "roundup", value: 100 });
    const e = { client_id: crypto.randomUUID(), space_id: anaPersonal, description: "Café", spent_at: "2026-11-12", amount_cents: 1234, currency: "EUR", fx_rate: 1, amount_base_cents: 1234, paid_from: "member", split_mode: "equal", is_private: false, tags: [],
      payers: [{ member_id: anaP, amount_cents: 1234 }], splits: [{ member_id: anaP, share_bp: 10000, amount_cents: 1234 }] };
    const { data: id } = await ana.client.rpc("save_expense", { p: e });
    const get = async () => (await ana.client.from("goal_contributions").select("amount_cents, source").eq("goal_id", goalP).eq("source", "roundup")).data!;
    expect(await get()).toEqual([{ amount_cents: 66, source: "roundup" }]);
    await ana.client.rpc("save_expense", { p: { ...e, id, amount_cents: 1250, amount_base_cents: 1250, payers: [{ member_id: anaP, amount_cents: 1250 }], splits: [{ member_id: anaP, share_bp: 10000, amount_cents: 1250 }] } });
    expect(await get()).toEqual([{ amount_cents: 50, source: "roundup" }]);
    await ana.client.rpc("delete_expense", { p_id: id as string });
    expect(await get()).toEqual([]);
  });

  it("regla de % de ingresos: 10 % de una nómina de 1.800 € aporta 180 €", async () => {
    await ana.client.from("saving_rules").insert({ space_id: anaPersonal, goal_id: goalP, kind: "percent_of_income", value: 1000 });
    const { data: inc } = await ana.client.rpc("save_income", { p: { space_id: anaPersonal, member_id: anaP, amount_cents: 180000, source: "Nómina", received_at: "2026-11-01" } });
    const { data } = await ana.client.from("goal_contributions").select("amount_cents").eq("goal_id", goalP).eq("source", "income_rule");
    expect(data).toEqual([{ amount_cents: 18000 }]);
    await ana.client.rpc("delete_income", { p_id: inc as string });
    expect((await ana.client.from("goal_contributions").select("id").eq("goal_id", goalP).eq("source", "income_rule")).data).toEqual([]);
  });

  it("el sobrante del cierre puede ir a una meta del mismo espacio, no a una ajena", async () => {
    await ana.client.rpc("save_plan", { p: { space_id: anaPersonal, month: "2026-06-01", incomes: [{ member_id: anaP, expected_cents: 100000 }], allocations: [] } });
    const fund = (await ana.client.from("funds").select("id").eq("space_id", anaPersonal).eq("name", "Ocio").single()).data!.id;
    expect((await ana.client.rpc("close_plan", { p_space: anaPersonal, p_month: "2026-06-01", p_decisions: [{ fund_id: fund, action: "goal", goal_id: goalH, leftover_cents: 100 }] })).error).not.toBeNull();
    expect((await ana.client.rpc("close_plan", { p_space: anaPersonal, p_month: "2026-06-01", p_decisions: [{ fund_id: fund, action: "goal", goal_id: goalP, leftover_cents: 4000 }] })).error).toBeNull();
    const { data } = await ana.client.from("goal_contributions").select("amount_cents").eq("goal_id", goalP).eq("source", "month_surplus");
    expect(data).toEqual([{ amount_cents: 4000 }]);
  });

  it("hitos: no se pueden colgar de una meta de otro espacio (FK compuesta)", async () => {
    expect((await ana.client.from("goal_milestones").insert({ goal_id: goalP, space_id: hogar, name: "X", amount_cents: 1 })).error).not.toBeNull();
    expect((await ana.client.from("goal_milestones").insert({ goal_id: goalH, space_id: hogar, name: "Hotel", amount_cents: 30000 })).error).toBeNull();
  });
});
