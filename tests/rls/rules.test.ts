import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS fase 3: reglas de categoría", () => {
  let ana: U, leo: U, eva: U;
  let group: string, other: string, catA: string, catOther: string;
  const toDelete: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva"); toDelete.push(ana.id, leo.id, eva.id);
    group = (await ana.client.rpc("create_space", { p_name: "Viernes noche", p_kind: "group" })).data as string;
    other = (await eva.client.rpc("create_space", { p_name: "Casa de Eva", p_kind: "household" })).data as string;
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: group, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 2 });
    await leo.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
    catA = (await ana.client.from("categories").select("id").eq("space_id", group).limit(1)).data![0]!.id;
    catOther = (await eva.client.from("categories").select("id").eq("space_id", other).limit(1)).data![0]!.id;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("un miembro crea y lee reglas de su burbuja; un ajeno ni las ve ni las crea", async () => {
    const ins = await ana.client.from("category_rules").insert({ space_id: group, match_text: "Mercadona", category_id: catA }).select("id").single();
    expect(ins.error).toBeNull();
    expect((await leo.client.from("category_rules").select("id").eq("space_id", group)).data).toHaveLength(1);
    expect((await eva.client.from("category_rules").select("id").eq("space_id", group)).data).toEqual([]);
    expect((await eva.client.from("category_rules").insert({ space_id: group, match_text: "x", category_id: catA })).error).not.toBeNull();
  });

  it("una regla no puede apuntar a la categoría de otra burbuja", async () => {
    const r = await ana.client.from("category_rules").insert({ space_id: group, match_text: "Zara", category_id: catOther });
    expect(r.error).not.toBeNull();
  });

  it("valida longitud, tipo y prioridad", async () => {
    expect((await ana.client.from("category_rules").insert({ space_id: group, match_text: "", category_id: catA })).error).not.toBeNull();
    expect((await ana.client.from("category_rules").insert({ space_id: group, match_text: "a".repeat(61), category_id: catA })).error).not.toBeNull();
    expect((await ana.client.from("category_rules").insert({ space_id: group, match_text: "ok", match_type: "regex", category_id: catA })).error).not.toBeNull();
    expect((await ana.client.from("category_rules").insert({ space_id: group, match_text: "ok", priority: -1, category_id: catA })).error).not.toBeNull();
  });

  it("las pistas de aprendizaje son privadas y cuentan los aciertos", async () => {
    expect((await ana.client.rpc("bump_rule_hint", { p_space: group, p_text: "Mercadona", p_category: catA })).data).toBe(1);
    expect((await ana.client.rpc("bump_rule_hint", { p_space: group, p_text: "Mercadona", p_category: catA })).data).toBe(2);
    expect((await leo.client.from("rule_hints").select("hits").eq("space_id", group)).data).toEqual([]);
    expect((await eva.client.rpc("bump_rule_hint", { p_space: group, p_text: "x", p_category: catA })).error).not.toBeNull();
    expect((await ana.client.from("rule_hints").insert({ space_id: group, text_key: "x", category_id: catA })).error).not.toBeNull();
  });
});
