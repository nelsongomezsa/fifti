import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS: vaciar espacio y aportar al hogar", () => {
  let ana: U, leo: U, eva: U;
  let group: string, hogar: string, anaPersonal: string, leoPersonal: string;
  let anaM: string, leoM: string;
  const toDelete: string[] = [];

  const mem = async (c: U["client"], space: string, uid: string) => (await c.from("space_members").select("id").eq("space_id", space).eq("user_id", uid).single()).data!.id as string;
  async function join(owner: U, space: string, user: U) {
    const t = newToken();
    await owner.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 5 });
    await user.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
  }
  const exp = (space: string, member: string, over: Record<string, unknown> = {}) => ({
    client_id: crypto.randomUUID(), space_id: space, description: "Cena", spent_at: "2026-11-10", amount_cents: 1000, currency: "EUR", fx_rate: 1, amount_base_cents: 1000,
    paid_from: "member", split_mode: "equal", is_private: false, tags: [],
    payers: [{ member_id: member, amount_cents: 1000 }], splits: [{ member_id: member, share_bp: 10000, amount_cents: 1000 }], ...over,
  });
  const count = async (table: string, space: string) => (await admin().from(table).select("id", { count: "exact", head: true }).eq("space_id", space)).count ?? 0;

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva"); toDelete.push(ana.id, leo.id, eva.id);
    anaPersonal = (await ana.client.from("spaces").select("id").eq("kind", "personal")).data![0]!.id;
    leoPersonal = (await leo.client.from("spaces").select("id").eq("kind", "personal")).data![0]!.id;
    group = (await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: "group" })).data as string;
    hogar = (await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household" })).data as string;
    await join(ana, group, leo); await join(ana, hogar, leo);
    anaM = await mem(ana.client, group, ana.id); leoM = await mem(ana.client, group, leo.id);
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("nadie vacía un espacio ajeno ni uno compartido sin ser su creador", async () => {
    await ana.client.rpc("save_expense", { p: exp(group, anaM) });
    expect((await eva.client.rpc("clear_space", { p_space: group })).error).not.toBeNull(); // sin ser miembro
    expect((await leo.client.rpc("clear_space", { p_space: group })).error).not.toBeNull(); // miembro, pero no el creador
    expect((await leo.client.rpc("clear_space", { p_space: anaPersonal })).error).not.toBeNull(); // el personal de otra persona
    expect((await ana.client.rpc("clear_space", { p_space: leoPersonal })).error).not.toBeNull();
    expect(await count("expenses", group)).toBe(1);
  });

  it("el creador vacía su grupo, se conserva el espacio, los miembros y los datos de otros espacios, y devuelve a quién avisar", async () => {
    await ana.client.rpc("save_income", { p: { space_id: group, member_id: anaM, amount_cents: 5000, source: "Extra", received_at: "2026-11-02" } });
    await ana.client.rpc("save_expense", { p: exp(anaPersonal, await mem(ana.client, anaPersonal, ana.id)) });
    const r = await ana.client.rpc("clear_space", { p_space: group });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ name: "Viaje Lisboa", kind: "group", others: [leo.id] });
    expect(await count("expenses", group)).toBe(0);
    expect(await count("incomes", group)).toBe(0);
    expect((await admin().from("spaces").select("id").eq("id", group)).data).toHaveLength(1);
    expect((await admin().from("space_members").select("id").eq("space_id", group)).data!.length).toBe(2);
    expect(await count("expenses", anaPersonal)).toBe(1); // otro espacio intacto
  });

  it("vaciar un espacio con un mes cerrado también funciona", async () => {
    const m = await mem(ana.client, anaPersonal, ana.id);
    await ana.client.rpc("save_expense", { p: exp(anaPersonal, m, { spent_at: "2026-10-05" }) });
    await admin().from("monthly_plans").insert({ space_id: anaPersonal, month: "2026-10-01", status: "closed" });
    const r = await ana.client.rpc("clear_space", { p_space: anaPersonal });
    expect(r.error).toBeNull();
    expect(await count("expenses", anaPersonal)).toBe(0);
  });

  it("aportar al hogar: solo miembros; sale en Personal y entra en el hogar con quién aportó; se acumula", async () => {
    expect((await eva.client.rpc("contribute_household", { p_space: hogar, p_amount: 1000 })).error).not.toBeNull();
    expect((await leo.client.rpc("contribute_household", { p_space: group, p_amount: 1000 })).error).not.toBeNull(); // no es un hogar
    expect((await leo.client.rpc("contribute_household", { p_space: hogar, p_amount: 0 })).error).not.toBeNull();
    expect((await leo.client.rpc("contribute_household", { p_space: hogar, p_amount: 25000 })).error).toBeNull();
    expect((await leo.client.rpc("contribute_household", { p_space: hogar, p_amount: 5000 })).error).toBeNull();
    const hm = await mem(ana.client, hogar, leo.id);
    const c = (await ana.client.from("contributions").select("member_id, paid_cents").eq("space_id", hogar)).data!;
    expect(c).toEqual([{ member_id: hm, paid_cents: 30000 }]); // Ana, miembro del hogar, ve que aportó Leo
    const out = (await admin().from("expenses").select("amount_cents, description").eq("space_id", leoPersonal)).data!;
    expect(out).toEqual([{ amount_cents: 30000, description: "Aportación a Casa de Ana y Leo" }]);
    void leoM;
  });
});
