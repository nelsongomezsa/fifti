import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS fase 9: plantillas, cambio de moneda y archivado", () => {
  let ana: U, leo: U;
  let trip: string, anaM: string;
  const toDelete: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); toDelete.push(ana.id, leo.id);
    trip = (await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: "group", p_template: "trip" })).data as string;
    anaM = (await ana.client.from("space_members").select("id").eq("space_id", trip).single()).data!.id;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  const exp = (over: Record<string, unknown> = {}) => ({
    client_id: crypto.randomUUID(), space_id: trip, description: "Taxi", spent_at: "2026-11-10", amount_cents: 1000, currency: "EUR", fx_rate: 1,
    amount_base_cents: 1000, paid_from: "member", split_mode: "equal", is_private: false, tags: [],
    payers: [{ member_id: anaM, amount_cents: 1000 }], splits: [{ member_id: anaM, share_bp: 10000, amount_cents: 1000 }], ...over,
  });

  it("la plantilla Viaje crea sus categorías", async () => {
    const { data } = await ana.client.from("categories").select("name").eq("space_id", trip);
    expect(data!.map((c) => c.name)).toEqual(expect.arrayContaining(["Alojamiento", "Actividades"]));
  });

  it("gasto en otra moneda: el cambio aplicado se guarda y debe cuadrar con el importe base", async () => {
    const ok = exp({ currency: "USD", amount_cents: 10000, fx_rate: 0.92341235, amount_base_cents: 9234, payers: [{ member_id: anaM, amount_cents: 9234 }], splits: [{ member_id: anaM, share_bp: 10000, amount_cents: 9234 }] });
    const { data: id, error } = await ana.client.rpc("save_expense", { p: ok });
    expect(error).toBeNull();
    const { data } = await ana.client.from("expenses").select("currency, fx_rate, amount_cents, amount_base_cents").eq("id", id as string).single();
    expect(data).toMatchObject({ currency: "USD", amount_cents: 10000, amount_base_cents: 9234 });
    expect(Number(data!.fx_rate)).toBeCloseTo(0.92341235, 8);
    // cambio trucado: 100 USD → 1 € no cuadra
    expect((await ana.client.rpc("save_expense", { p: { ...ok, client_id: crypto.randomUUID(), amount_base_cents: 100, payers: [{ member_id: anaM, amount_cents: 100 }], splits: [{ member_id: anaM, share_bp: 10000, amount_cents: 100 }] } })).error).not.toBeNull();
    // misma moneda con cambio ≠ 1
    expect((await ana.client.rpc("save_expense", { p: exp({ fx_rate: 2 }) })).error).not.toBeNull();
  });

  it("la caché de tipos de cambio solo la toca el servidor", async () => {
    expect((await ana.client.from("fx_rates").select("*")).data ?? []).toEqual([]);
    expect((await ana.client.from("fx_rates").insert({ day: "2026-11-10", base: "USD", quote: "EUR", rate: 0.9 })).error).not.toBeNull();
    expect((await admin().from("fx_rates").upsert({ day: "2026-11-10", base: "USD", quote: "EUR", rate: 0.9 })).error).toBeNull();
  });

  it("presupuesto diario: solo el owner lo cambia", async () => {
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: trip, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 2 });
    await leo.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
    await leo.client.from("spaces").update({ daily_budget_cents: 1 }).eq("id", trip);
    await ana.client.from("spaces").update({ daily_budget_cents: 5000 }).eq("id", trip);
    expect((await ana.client.from("spaces").select("daily_budget_cents").eq("id", trip).single()).data).toEqual({ daily_budget_cents: 5000 });
  });

  it("archivar: solo el owner; no se añaden gastos a un plan archivado; la burbuja personal no se archiva", async () => {
    expect((await leo.client.from("spaces").update({ archived_at: new Date().toISOString() }).eq("id", trip).select("id")).data).toEqual([]);
    const personal = (await ana.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id;
    expect((await ana.client.from("spaces").update({ archived_at: new Date().toISOString() }).eq("id", personal)).error).not.toBeNull();
    expect((await ana.client.from("spaces").update({ archived_at: new Date().toISOString() }).eq("id", trip).select("id")).data).toHaveLength(1);
    expect((await ana.client.rpc("save_expense", { p: exp() })).error).not.toBeNull();
    // el archivo sigue siendo legible para los miembros
    expect((await leo.client.from("spaces").select("id").eq("id", trip)).data).toHaveLength(1);
    await ana.client.from("spaces").update({ archived_at: null }).eq("id", trip);
    expect((await ana.client.rpc("save_expense", { p: exp() })).error).toBeNull();
  });

  it("los invitados no cambian ajustes del plan", async () => {
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: trip, p_kind: "guest", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 2 });
    const guest = await createGuest(); toDelete.push(guest.id);
    await guest.client.rpc("join_as_guest", { p_token_hash: await sha256(t), p_member: null, p_name: "Marta" });
    expect((await guest.client.from("spaces").update({ archived_at: new Date().toISOString() }).eq("id", trip).select("id")).data).toEqual([]);
    expect((await guest.client.from("spaces").update({ daily_budget_cents: 1 }).eq("id", trip).select("id")).data).toEqual([]);
  });
});
