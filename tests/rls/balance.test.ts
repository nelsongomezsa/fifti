import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS fase 5: liquidaciones y compensaciones", () => {
  let ana: U, leo: U, eva: U;
  let lisboa: string, hogar: string;
  const m: Record<string, string> = {};
  const toDelete: string[] = [];

  async function join(owner: U, space: string, user: U) {
    const t = newToken();
    await owner.client.rpc("create_share_link", { p_space: space, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 5 });
    await user.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
  }
  async function memberId(client: U["client"], space: string, uid: string) {
    return (await client.from("space_members").select("id").eq("space_id", space).eq("user_id", uid).single()).data!.id as string;
  }

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva");
    toDelete.push(ana.id, leo.id, eva.id);
    lisboa = (await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: "group" })).data as string;
    hogar = (await ana.client.rpc("create_space", { p_name: "Hogar", p_kind: "household" })).data as string;
    await join(ana, lisboa, leo); await join(ana, hogar, leo); await join(ana, lisboa, eva);
    for (const [s, k] of [[lisboa, "l"], [hogar, "h"]] as const) {
      m[`ana-${k}`] = await memberId(ana.client, s, ana.id);
      m[`leo-${k}`] = await memberId(ana.client, s, leo.id);
    }
    m["eva-l"] = await memberId(ana.client, lisboa, eva.id);
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("registrar un pago: solo quien paga, quien cobra o el owner; extraños no", async () => {
    const args = (from: string, to: string) => ({ p_space: lisboa, p_from: from, p_to: to, p_amount: 500, p_method: "bizum", p_note: null, p_date: null });
    expect((await leo.client.rpc("record_settlement", args(m["leo-l"]!, m["ana-l"]!))).error).toBeNull();
    expect((await eva.client.rpc("record_settlement", args(m["leo-l"]!, m["ana-l"]!))).error).not.toBeNull(); // Eva no es parte (y no es owner)
    const stranger = await createUser("Zoe"); toDelete.push(stranger.id);
    expect((await stranger.client.rpc("record_settlement", args(m["leo-l"]!, m["ana-l"]!))).error).not.toBeNull();
    expect((await stranger.client.from("settlements").select("id").eq("space_id", lisboa)).data).toEqual([]);
  });

  it("no se puede registrar a mano un pago de tipo 'offset' ni importes inválidos", async () => {
    const base = { p_space: lisboa, p_from: m["leo-l"], p_to: m["ana-l"], p_note: null, p_date: null };
    expect((await ana.client.rpc("record_settlement", { ...base, p_amount: 100, p_method: "offset" })).error).not.toBeNull();
    expect((await ana.client.rpc("record_settlement", { ...base, p_amount: 0, p_method: "cash" })).error).not.toBeNull();
    expect((await ana.client.from("settlements").insert({ space_id: lisboa, from_member: m["leo-l"], to_member: m["ana-l"], amount_cents: 1 })).error).not.toBeNull();
  });

  const lines = (a: number, b: number) => [
    { space_id: lisboa, from_member: m["leo-l"], to_member: m["ana-l"], amount_cents: a }, // Leo debe a Ana en Lisboa
    { space_id: hogar, from_member: m["ana-h"], to_member: m["leo-h"], amount_cents: b }, // Ana debe a Leo en Hogar
  ];

  it("compensación: exige importes iguales en ambos sentidos y que las dos personas compartan el grupo", async () => {
    expect((await ana.client.rpc("propose_offset", { p_other: leo.id, p_lines: lines(2000, 1000) })).error).not.toBeNull();
    // Eva no comparte Hogar con Ana
    const bad = [lines(2000, 2000)[0], { space_id: hogar, from_member: m["ana-h"], to_member: m["leo-h"], amount_cents: 2000 }];
    expect((await ana.client.rpc("propose_offset", { p_other: eva.id, p_lines: bad })).error).not.toBeNull();
    // un tercero no puede proponer entre otros dos
    expect((await eva.client.rpc("propose_offset", { p_other: leo.id, p_lines: lines(2000, 2000) })).error).not.toBeNull();
  });

  it("la compensación necesita que LOS DOS confirmen; entonces crea liquidaciones 'offset' enlazadas", async () => {
    const { data: id, error } = await ana.client.rpc("propose_offset", { p_other: leo.id, p_lines: lines(2000, 2000) });
    expect(error).toBeNull();
    // un extraño no la ve ni la confirma
    expect((await eva.client.from("cross_offsets").select("id").eq("id", id as string)).data).toEqual([]);
    expect((await eva.client.rpc("confirm_offset", { p_id: id as string })).error).not.toBeNull();
    // tras la confirmación de quien propone, aún no hay liquidaciones
    expect((await admin().from("settlements").select("id").eq("offset_id", id as string)).data).toEqual([]);
    // confirmar dos veces seguidas por la misma persona no cuenta como confirmación del otro
    await ana.client.rpc("confirm_offset", { p_id: id as string });
    expect((await admin().from("settlements").select("id").eq("offset_id", id as string)).data).toEqual([]);
    const r = await leo.client.rpc("confirm_offset", { p_id: id as string });
    expect(r.data).toBe("confirmed");
    const { data: s } = await admin().from("settlements").select("space_id, method, amount_cents").eq("offset_id", id as string);
    expect(s).toHaveLength(2);
    expect(s!.every((x) => x.method === "offset" && x.amount_cents === 2000)).toBe(true);
    // ya confirmada: no se puede confirmar ni rechazar de nuevo
    expect((await leo.client.rpc("reject_offset", { p_id: id as string })).error).not.toBeNull();
    // una compensación no se puede borrar
    const off = s ? (await ana.client.from("settlements").select("id").eq("offset_id", id as string)).data![0]!.id : "";
    expect((await ana.client.rpc("delete_settlement", { p_id: off })).error).not.toBeNull();
  });

  it("rechazar una propuesta la cierra sin crear liquidaciones", async () => {
    const { data: id } = await ana.client.rpc("propose_offset", { p_other: leo.id, p_lines: lines(300, 300) });
    expect((await leo.client.rpc("reject_offset", { p_id: id as string })).error).toBeNull();
    expect((await leo.client.rpc("confirm_offset", { p_id: id as string })).error).not.toBeNull();
    expect((await admin().from("settlements").select("id").eq("offset_id", id as string)).data).toEqual([]);
  });

  it("cada uno solo ve los saldos de los grupos compartidos: Eva no ve Hogar", async () => {
    expect((await eva.client.from("settlements").select("id").eq("space_id", hogar)).data).toEqual([]);
    expect((await eva.client.from("cross_offset_lines").select("id")).data).toEqual([]);
  });

  it("los invitados no proponen compensaciones", async () => {
    const guest = await (await import("./helpers")).createGuest(); toDelete.push(guest.id);
    expect((await guest.client.rpc("propose_offset", { p_other: leo.id, p_lines: lines(1, 1) })).error).not.toBeNull();
  });

  it("el resumen público solo lo lee service_role y solo con token válido", async () => {
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: lisboa, p_kind: "public_summary", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 100 });
    expect((await leo.client.rpc("public_summary_data", { p_token_hash: await sha256(t) })).error).not.toBeNull();
    const { data } = await admin().rpc("public_summary_data", { p_token_hash: await sha256(t) });
    expect(data).toMatchObject({ space_name: "Viaje Lisboa" });
    expect(JSON.stringify(data)).not.toMatch(/description|concepto/i);
    expect((await admin().rpc("public_summary_data", { p_token_hash: await sha256(newToken()) })).data).toBeNull();
    // un token de invitación no sirve como resumen
    const inv = newToken();
    await ana.client.rpc("create_share_link", { p_space: lisboa, p_kind: "invite", p_token_hash: await sha256(inv), p_ttl_seconds: 3600, p_max_uses: 1 });
    expect((await admin().rpc("public_summary_data", { p_token_hash: await sha256(inv) })).data).toBeNull();
  });
});
