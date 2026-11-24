import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, rlsConfigured } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!rlsConfigured)("RLS fase 6: tendencias y recordatorio", () => {
  let ana: U, leo: U;
  let personal: string, anaM: string;
  const toDelete: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); toDelete.push(ana.id, leo.id);
    personal = (await ana.client.from("spaces").select("id").eq("kind", "personal")).data![0]!.id;
    anaM = (await ana.client.from("space_members").select("id").eq("space_id", personal)).data![0]!.id;
    await ana.client.rpc("save_expense", { p: {
      client_id: crypto.randomUUID(), space_id: personal, description: "Café", spent_at: today(), amount_cents: 250, currency: "EUR", fx_rate: 1, amount_base_cents: 250,
      paid_from: "member", split_mode: "equal", is_private: false, tags: [], payers: [{ member_id: anaM, amount_cents: 250 }], splits: [{ member_id: anaM, share_bp: 10000, amount_cents: 250 }],
    } });
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("el desglose mensual solo devuelve datos de burbujas propias", async () => {
    const mine = await ana.client.rpc("monthly_breakdown", { p_space: personal, p_from: "2020-01-01" });
    expect(mine.error).toBeNull();
    expect(mine.data!.reduce((a: number, r: { total_cents: number }) => a + Number(r.total_cents), 0)).toBe(250);
    const other = await leo.client.rpc("monthly_breakdown", { p_space: personal, p_from: "2020-01-01" });
    expect(other.data).toEqual([]);
  });

  it("el recordatorio está desactivado por defecto y solo cada persona toca el suyo", async () => {
    expect((await ana.client.from("notification_prefs").insert({ user_id: ana.id })).error).toBeNull();
    expect((await ana.client.from("notification_prefs").select("daily_reminder, reminder_hour, timezone")).data).toEqual([{ daily_reminder: false, reminder_hour: 21, timezone: "Europe/Madrid" }]);
    expect((await ana.client.from("notification_prefs").update({ daily_reminder: true, reminder_hour: 8, timezone: "America/New_York" }).eq("user_id", ana.id)).error).toBeNull();
    await leo.client.from("notification_prefs").update({ daily_reminder: true }).eq("user_id", ana.id);
    expect((await admin().from("notification_prefs").select("reminder_hour").eq("user_id", ana.id)).data).toEqual([{ reminder_hour: 8 }]);
    expect((await leo.client.from("notification_prefs").select("user_id").eq("user_id", ana.id)).data).toEqual([]);
  });

  it("valida la hora y la zona horaria", async () => {
    expect((await ana.client.from("notification_prefs").update({ reminder_hour: 24 }).eq("user_id", ana.id)).error).not.toBeNull();
    expect((await ana.client.from("notification_prefs").update({ timezone: "drop table; --" }).eq("user_id", ana.id)).error).not.toBeNull();
    expect((await ana.client.from("notification_prefs").update({ timezone: "x".repeat(65) }).eq("user_id", ana.id)).error).not.toBeNull();
  });

  it("la función que llama a la ruta del recordatorio no la puede ejecutar nadie desde la app", async () => {
    expect((await ana.client.rpc("call_reminders")).error).not.toBeNull();
  });
});
