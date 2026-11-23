import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, createUser, rlsConfigured } from "./helpers";

// Se omiten si no hay Supabase de pruebas configurado.
describe.skipIf(!rlsConfigured)("RLS fase 1", () => {
  let ana: Awaited<ReturnType<typeof createUser>>;
  let leo: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    ana = await createUser("Ana");
    leo = await createUser("Leo");
  });
  afterAll(async () => {
    await admin().auth.admin.deleteUser(ana.id);
    await admin().auth.admin.deleteUser(leo.id);
  });

  it("el registro crea perfil y un único espacio personal", async () => {
    const { data: spaces } = await ana.client.from("spaces").select("id, kind, created_by");
    expect(spaces).toHaveLength(1);
    expect(spaces![0]).toMatchObject({ kind: "personal", created_by: ana.id });
    const { data: profile } = await ana.client.from("profiles").select("display_name");
    expect(profile).toEqual([{ display_name: "Ana" }]);
  });

  it("un usuario no ve los espacios, miembros ni perfiles de otro (IDOR)", async () => {
    const { data: leoSpaces } = await leo.client.from("spaces").select("id");
    const leoSpaceId = leoSpaces![0]!.id;

    const { data: seen } = await ana.client.from("spaces").select("id").eq("id", leoSpaceId);
    expect(seen).toEqual([]);
    const { data: members } = await ana.client.from("space_members").select("id").eq("space_id", leoSpaceId);
    expect(members).toEqual([]);
    const { data: profiles } = await ana.client.from("profiles").select("id").eq("id", leo.id);
    expect(profiles).toEqual([]);
  });

  it("no se puede editar ni borrar el espacio de otro", async () => {
    const { data: leoSpaces } = await leo.client.from("spaces").select("id");
    const id = leoSpaces![0]!.id;
    await ana.client.from("spaces").update({ name: "Hackeado" }).eq("id", id);
    await ana.client.from("spaces").delete().eq("id", id);
    const { data } = await leo.client.from("spaces").select("name").eq("id", id);
    expect(data).toEqual([{ name: "Personal" }]);
  });

  it("no se puede añadir a nadie a un espacio personal", async () => {
    const { data } = await leo.client.from("spaces").select("id");
    const { error } = await admin()
      .from("space_members")
      .insert({ space_id: data![0]!.id, user_id: ana.id, display_name: "Ana" });
    expect(error).not.toBeNull();
  });

  it("no se pueden cambiar columnas de confianza (role, user_id)", async () => {
    const { data: me } = await ana.client.from("space_members").select("id").limit(1);
    const { error } = await ana.client.from("space_members").update({ role: "guest" }).eq("id", me![0]!.id);
    expect(error).not.toBeNull();
  });

  it("anon no accede a nada", async () => {
    const anon = anonClient();
    for (const t of ["profiles", "spaces", "space_members", "audit_log", "rate_limits"]) {
      const { data, error } = await anon.from(t).select("*");
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
  });

  it("nadie con sesión toca rate_limits ni llama a rate_limit_hit", async () => {
    const { data } = await ana.client.from("rate_limits").select("*");
    expect(data ?? []).toEqual([]);
    const { error } = await ana.client.rpc("rate_limit_hit", { p_key: "x", p_limit: 1, p_window_seconds: 60 });
    expect(error).not.toBeNull();
  });

  it("el rate limit corta al superar el límite", async () => {
    const key = `test:${crypto.randomUUID()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const { data } = await admin().rpc("rate_limit_hit", { p_key: key, p_limit: 3, p_window_seconds: 60 });
      results.push(data as boolean);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  it("audit_log es de solo inserción", async () => {
    const a = admin();
    const { data, error } = await a.from("audit_log").insert({ table_name: "t", action: "insert" }).select("id").single();
    expect(error).toBeNull();
    const upd = await a.from("audit_log").update({ table_name: "x" }).eq("id", data!.id);
    expect(upd.error).not.toBeNull();
    const del = await a.from("audit_log").delete().eq("id", data!.id);
    expect(del.error).not.toBeNull();
  });
});
