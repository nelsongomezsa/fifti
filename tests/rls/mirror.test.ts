import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS fase 7: reflejo grupo → personal y cierre de mes", () => {
  let ana: U, leo: U;
  let lisboa: string, hogar: string, anaL: string, leoL: string, anaH: string;
  let anaPersonal: string;
  const toDelete: string[] = [];

  const expense = (space: string, a: string, b: string, over: Record<string, unknown> = {}) => ({
    client_id: crypto.randomUUID(), space_id: space, description: "Cena", spent_at: "2026-11-10", amount_cents: 3000, currency: "EUR", fx_rate: 1,
    amount_base_cents: 3000, paid_from: "member", split_mode: "equal", is_private: false, tags: [],
    payers: [{ member_id: a, amount_cents: 3000 }], splits: [{ member_id: a, share_bp: 5000, amount_cents: 1500 }, { member_id: b, share_bp: 5000, amount_cents: 1500 }], ...over,
  });
  const mirror = async (u: U) => (await u.client.from("personal_mirror").select("amount_cents, label, fund_id, source_expense_id")).data ?? [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); toDelete.push(ana.id, leo.id);
    lisboa = (await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: "group" })).data as string;
    hogar = (await ana.client.rpc("create_space", { p_name: "Casa", p_kind: "household" })).data as string;
    for (const s of [lisboa, hogar]) {
      const t = newToken();
      await ana.client.rpc("create_share_link", { p_space: s, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 2 });
      await leo.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
    }
    const ms = async (s: string) => (await ana.client.from("space_members").select("id, user_id").eq("space_id", s)).data!;
    anaL = (await ms(lisboa)).find((m) => m.user_id === ana.id)!.id; leoL = (await ms(lisboa)).find((m) => m.user_id === leo.id)!.id;
    anaH = (await ms(hogar)).find((m) => m.user_id === ana.id)!.id;
    anaPersonal = (await ana.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("tu parte de un gasto de grupo entra sola en tu plan personal (fondo Ocio) y solo la ves tú", async () => {
    const { data: id } = await ana.client.rpc("save_expense", { p: expense(lisboa, anaL, leoL) });
    const a = await mirror(ana), l = await mirror(leo);
    expect(a.filter((m) => m.source_expense_id === id)).toEqual([expect.objectContaining({ amount_cents: 1500, label: "Viaje Lisboa" })]);
    expect(l.filter((m) => m.source_expense_id === id)).toHaveLength(1); // cada uno ve el suyo
    expect((await ana.client.from("personal_mirror").select("id").neq("user_id", ana.id)).data).toEqual([]);
    const { data: f } = await ana.client.from("funds").select("name").eq("id", a.find((m) => m.source_expense_id === id)!.fund_id).single();
    expect(f!.name).toBe("Ocio");
  });

  it("al editar el gasto el reflejo se actualiza y al borrarlo desaparece", async () => {
    const e = expense(lisboa, anaL, leoL);
    const { data: id } = await ana.client.rpc("save_expense", { p: e });
    await ana.client.rpc("save_expense", { p: { ...e, id, amount_cents: 4000, amount_base_cents: 4000, payers: [{ member_id: anaL, amount_cents: 4000 }], splits: [{ member_id: anaL, share_bp: 5000, amount_cents: 2000 }, { member_id: leoL, share_bp: 5000, amount_cents: 2000 }] } });
    expect((await mirror(ana)).find((m) => m.source_expense_id === id)!.amount_cents).toBe(2000);
    await ana.client.rpc("delete_expense", { p_id: id as string });
    expect((await mirror(ana)).find((m) => m.source_expense_id === id)).toBeUndefined();
  });

  it("gastos pagados desde el bote no se reflejan (ya cuentan vía la aportación)", async () => {
    const e = expense(hogar, anaH, anaH, { paid_from: "pot", payers: [], splits: [{ member_id: anaH, share_bp: 10000, amount_cents: 3000 }] });
    const { data: id } = await ana.client.rpc("save_expense", { p: e });
    expect((await mirror(ana)).find((m) => m.source_expense_id === id)).toBeUndefined();
  });

  it("desactivar el reflejo de un grupo lo quita; elegir fondo propio lo mueve; fondos ajenos se rechazan", async () => {
    const { data: id } = await ana.client.rpc("save_expense", { p: expense(lisboa, anaL, leoL) });
    expect((await ana.client.rpc("set_mirror_pref", { p_space: lisboa, p_enabled: false, p_fund: null })).error).toBeNull();
    expect((await mirror(ana)).find((m) => m.source_expense_id === id)).toBeUndefined();
    expect((await mirror(leo)).find((m) => m.source_expense_id === id)).toBeDefined(); // lo de Leo no cambia
    const fund = (await ana.client.from("funds").select("id").eq("space_id", anaPersonal).eq("name", "Día a día").single()).data!.id;
    expect((await ana.client.rpc("set_mirror_pref", { p_space: lisboa, p_enabled: true, p_fund: fund })).error).toBeNull();
    expect((await mirror(ana)).find((m) => m.source_expense_id === id)!.fund_id).toBe(fund);
    const leoFund = (await leo.client.from("funds").select("id").limit(1)).data![0]!.id;
    expect((await ana.client.rpc("set_mirror_pref", { p_space: lisboa, p_enabled: true, p_fund: leoFund })).error).not.toBeNull();
    expect((await leo.client.rpc("set_mirror_pref", { p_space: anaPersonal, p_enabled: true, p_fund: null })).error).not.toBeNull();
  });

  it("nadie escribe directamente en personal_mirror ni en las preferencias", async () => {
    expect((await ana.client.from("personal_mirror").insert({ user_id: ana.id, source_expense_id: crypto.randomUUID(), personal_space_id: anaPersonal, fund_id: crypto.randomUUID(), amount_cents: 1, spent_at: "2026-11-01", label: "x" })).error).not.toBeNull();
    expect((await ana.client.from("mirror_prefs").insert({ user_id: ana.id, space_id: lisboa })).error).not.toBeNull();
    expect((await leo.client.from("mirror_prefs").select("*").eq("user_id", ana.id)).data).toEqual([]);
  });

  describe("cierre de mes", () => {
    const plan = (space: string, month: string, mid: string) => ({ space_id: space, month, incomes: [{ member_id: mid, expected_cents: 100000 }], allocations: [] });

    it("solo el owner cierra un hogar; el mes cerrado bloquea gastos; se puede reabrir", async () => {
      await ana.client.rpc("save_plan", { p: plan(hogar, "2026-09-01", anaH) });
      expect((await leo.client.rpc("close_plan", { p_space: hogar, p_month: "2026-09-01", p_decisions: [] })).error).not.toBeNull();
      expect((await ana.client.rpc("close_plan", { p_space: hogar, p_month: "2026-09-01", p_decisions: [] })).error).toBeNull();
      const e = expense(hogar, anaH, anaH, { spent_at: "2026-09-12", splits: [{ member_id: anaH, share_bp: 10000, amount_cents: 3000 }] });
      expect((await ana.client.rpc("save_expense", { p: e })).error).not.toBeNull();
      expect((await ana.client.rpc("save_plan", { p: plan(hogar, "2026-09-01", anaH) })).error).not.toBeNull();
      expect((await leo.client.rpc("reopen_plan", { p_space: hogar, p_month: "2026-09-01" })).error).not.toBeNull();
      expect((await ana.client.rpc("reopen_plan", { p_space: hogar, p_month: "2026-09-01" })).error).toBeNull();
      expect((await ana.client.rpc("save_expense", { p: e })).error).toBeNull();
    });

    it("el sobrante 'pasa al mes siguiente' como arrastre del fondo", async () => {
      await ana.client.rpc("save_plan", { p: plan(hogar, "2026-07-01", anaH) });
      const fund = (await ana.client.from("funds").select("id").eq("space_id", hogar).eq("name", "Ocio").single()).data!.id;
      const r = await ana.client.rpc("close_plan", { p_space: hogar, p_month: "2026-07-01", p_decisions: [{ fund_id: fund, action: "rollover", leftover_cents: 4200 }] });
      expect(r.error).toBeNull();
      const { data: next } = await ana.client.from("monthly_plans").select("id").eq("space_id", hogar).eq("month", "2026-08-01").single();
      const { data: al } = await ana.client.from("plan_allocations").select("carry_cents").eq("plan_id", next!.id).eq("fund_id", fund).single();
      expect(al!.carry_cents).toBe(4200);
    });

    it("reabrir el mes deshace el arrastre del sobrante y las aportaciones a metas", async () => {
      await ana.client.rpc("save_plan", { p: plan(hogar, "2026-04-01", anaH) });
      const fund = (await ana.client.from("funds").select("id").eq("space_id", hogar).eq("name", "Ocio").single()).data!.id;
      const other = (await ana.client.from("funds").select("id").eq("space_id", hogar).eq("name", "Ahorro").single()).data!.id;
      const goal = (await ana.client.from("savings_goals").insert({ space_id: hogar, name: "Viaje", target_cents: 100000 }).select("id").single()).data!.id;
      const dec = [{ fund_id: fund, action: "rollover", leftover_cents: 4200 }, { fund_id: other, action: "goal", goal_id: goal, leftover_cents: 1500 }];
      expect((await ana.client.rpc("close_plan", { p_space: hogar, p_month: "2026-04-01", p_decisions: dec })).error).toBeNull();
      const carry = async () => (await ana.client.from("plan_allocations").select("carry_cents, monthly_plans!inner(month, space_id)").eq("fund_id", fund).eq("monthly_plans.month", "2026-05-01")).data ?? [];
      expect((await carry())[0]!.carry_cents).toBe(4200);
      expect((await ana.client.from("goal_contributions").select("amount_cents").eq("goal_id", goal).eq("source", "month_surplus")).data).toEqual([{ amount_cents: 1500 }]);
      expect((await ana.client.rpc("reopen_plan", { p_space: hogar, p_month: "2026-04-01" })).error).toBeNull();
      expect(await carry()).toEqual([]); // el plan de mayo lo creó el cierre y vuelve a no existir
      expect((await ana.client.from("goal_contributions").select("id").eq("goal_id", goal).eq("source", "month_surplus")).data).toEqual([]);
      // cerrar de nuevo vuelve a aplicar una sola vez (sin doble arrastre)
      await ana.client.rpc("close_plan", { p_space: hogar, p_month: "2026-04-01", p_decisions: dec });
      expect((await carry())[0]!.carry_cents).toBe(4200);
    });

    it("reabrir conserva el plan siguiente si ya tenía contenido propio", async () => {
      await ana.client.rpc("save_plan", { p: plan(hogar, "2026-02-01", anaH) });
      await ana.client.rpc("save_plan", { p: plan(hogar, "2026-03-01", anaH) });
      const fund = (await ana.client.from("funds").select("id").eq("space_id", hogar).eq("name", "Ocio").single()).data!.id;
      await ana.client.rpc("close_plan", { p_space: hogar, p_month: "2026-02-01", p_decisions: [{ fund_id: fund, action: "rollover", leftover_cents: 900 }] });
      await ana.client.rpc("reopen_plan", { p_space: hogar, p_month: "2026-02-01" });
      expect((await ana.client.from("monthly_plans").select("id").eq("space_id", hogar).eq("month", "2026-03-01")).data).toHaveLength(1);
      expect((await ana.client.from("plan_allocations").select("carry_cents, monthly_plans!inner(month)").eq("fund_id", fund).eq("monthly_plans.month", "2026-03-01")).data).toEqual([]);
    });

    it("borrar un espacio no se bloquea por tener meses cerrados", async () => {
      const tmp = (await ana.client.rpc("create_space", { p_name: "Temporal", p_kind: "household" })).data as string;
      const m = (await ana.client.from("space_members").select("id").eq("space_id", tmp).single()).data!.id;
      await ana.client.rpc("save_expense", { p: expense(tmp, m, m, { splits: [{ member_id: m, share_bp: 10000, amount_cents: 3000 }] }) });
      await ana.client.rpc("save_plan", { p: plan(tmp, "2026-11-01", m) });
      await ana.client.rpc("close_plan", { p_space: tmp, p_month: "2026-11-01", p_decisions: [] });
      expect((await ana.client.from("spaces").delete().eq("id", tmp)).error).toBeNull();
    });
  });

  it("las series mensuales respetan RLS", async () => {
    const { data } = await leo.client.rpc("monthly_spend", { p_space: anaPersonal, p_from: "2026-01-01" });
    expect(data).toEqual([]);
  });
});
