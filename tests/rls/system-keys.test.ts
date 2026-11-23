import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, rlsConfigured } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("fondos y categorías del sistema (system_key)", () => {
  let ana: U, leo: U;
  let personal: string, trip: string;

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo");
    personal = (await ana.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id;
    trip = (await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: "group", p_template: "trip" })).data as string;
  });
  afterAll(async () => { await admin().auth.admin.deleteUser(ana.id); await admin().auth.admin.deleteUser(leo.id); });

  it("la siembra pone clave a todos los fondos y categorías por defecto", async () => {
    const { data: f } = await ana.client.from("funds").select("name, system_key").eq("space_id", personal);
    expect(f!.every((x) => x.system_key)).toBe(true);
    expect(f!.find((x) => x.system_key === "fund.fixed")!.name).toBe("Gastos fijos");
    const { data: c } = await ana.client.from("categories").select("name, system_key").eq("space_id", trip);
    expect(c!.map((x) => x.system_key).sort()).toEqual(["cat.activities", "cat.food", "cat.lodging", "cat.other", "cat.shopping", "cat.transport"]);
  });

  it("los que crea el usuario no tienen clave", async () => {
    const { data, error } = await ana.client.from("funds").insert({ space_id: personal, name: "Gastos fijos", kind: "other" }).select("system_key").single();
    expect(error).toBeNull();
    expect(data!.system_key).toBeNull(); // mismo nombre que uno del sistema, pero suyo
  });

  it("un cliente no puede fijar ni cambiar la clave (alta ni edición)", async () => {
    expect((await ana.client.from("funds").insert({ space_id: personal, name: "X", kind: "other", system_key: "fund.fixed" })).error).not.toBeNull();
    expect((await ana.client.from("categories").insert({ space_id: personal, fund_id: (await ana.client.from("funds").select("id").eq("space_id", personal).limit(1).single()).data!.id, name: "Y", system_key: "cat.rent" })).error).not.toBeNull();
    const f = (await ana.client.from("funds").select("id").eq("space_id", personal).eq("system_key", "fund.leisure").single()).data!;
    expect((await ana.client.from("funds").update({ system_key: "fund.fixed" }).eq("id", f.id)).error).not.toBeNull();
    expect((await ana.client.from("funds").update({ system_key: null }).eq("id", f.id)).error).not.toBeNull();
  });

  it("si el usuario renombra uno del sistema pasa a ser suyo (pierde la clave)", async () => {
    const f = (await ana.client.from("funds").select("id").eq("space_id", personal).eq("system_key", "fund.leisure").single()).data!;
    expect((await ana.client.from("funds").update({ name: "Mis caprichos" }).eq("id", f.id)).error).toBeNull();
    expect((await ana.client.from("funds").select("name, system_key").eq("id", f.id).single()).data).toEqual({ name: "Mis caprichos", system_key: null });
    // cambiar otras columnas (color) no lo toca
    const g = (await ana.client.from("funds").select("id").eq("space_id", personal).eq("system_key", "fund.savings").single()).data!;
    await ana.client.from("funds").update({ color: "#112233" }).eq("id", g.id);
    expect((await ana.client.from("funds").select("system_key").eq("id", g.id).single()).data).toEqual({ system_key: "fund.savings" });
  });

  it("la clave es única por espacio y solo se ve en los espacios propios", async () => {
    const { data } = await ana.client.from("funds").select("system_key").eq("space_id", personal).not("system_key", "is", null);
    const keys = data!.map((x) => x.system_key);
    expect(new Set(keys).size).toBe(keys.length);
    expect((await leo.client.from("funds").select("id").eq("space_id", personal)).data).toEqual([]);
  });
});
