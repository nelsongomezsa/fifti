import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, rlsConfigured } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!rlsConfigured)("RLS: gastos fijos trimestrales y ocurrencias saltadas", () => {
  let ana: U, eva: U;
  let personal: string, anaM: string, rec: string;
  const toDelete: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); eva = await createUser("Eva"); toDelete.push(ana.id, eva.id);
    personal = (await ana.client.from("spaces").select("id").eq("kind", "personal")).data![0]!.id;
    anaM = (await ana.client.from("space_members").select("id").eq("space_id", personal)).data![0]!.id;
    const r = await ana.client.rpc("save_recurring", { p: { space_id: personal, description: "Seguro", amount_cents: 12000, frequency: "quarterly", day: 1, next_run: today(), paid_from: "member" } });
    expect(r.error).toBeNull();
    rec = r.data as string;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("la frecuencia trimestral se guarda", async () => {
    expect((await ana.client.from("recurring_expenses").select("frequency").eq("id", rec)).data).toEqual([{ frequency: "quarterly" }]);
  });

  it("solo quien puede editar el gasto fijo salta una ocurrencia; los ajenos no la ven ni la crean", async () => {
    expect((await eva.client.rpc("set_recurring_skip", { p_recurring: rec, p_date: today(), p_skip: true })).error).not.toBeNull();
    expect((await ana.client.rpc("set_recurring_skip", { p_recurring: rec, p_date: today(), p_skip: true })).error).toBeNull();
    expect((await ana.client.from("recurring_skips").select("skip_on").eq("recurring_id", rec)).data).toEqual([{ skip_on: today() }]);
    expect((await eva.client.from("recurring_skips").select("skip_on").eq("recurring_id", rec)).data).toEqual([]);
  });

  it("una ocurrencia saltada no genera el gasto y el siguiente cobro avanza tres meses", async () => {
    await admin().rpc("process_recurring");
    expect((await admin().from("expenses").select("id").eq("recurring_id", rec)).data).toEqual([]);
    const next = (await admin().from("recurring_expenses").select("next_run").eq("id", rec)).data![0]!.next_run as string;
    expect(next > today()).toBe(true);
    const diff = (Date.parse(next) - Date.parse(today())) / 86400000;
    expect(diff).toBeGreaterThan(55);
    expect(diff).toBeLessThan(95);
  });

  it("no se puede saltar una fecha ya pasada", async () => {
    const past = "2020-01-01";
    expect((await ana.client.rpc("set_recurring_skip", { p_recurring: rec, p_date: past, p_skip: true })).error).not.toBeNull();
    void anaM;
  });
});
