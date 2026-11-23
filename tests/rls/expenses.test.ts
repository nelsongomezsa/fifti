import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS fase 3: gastos", () => {
  let ana: U, leo: U, eva: U;
  let groupId: string, anaMember: string, leoMember: string;
  let personalId: string;
  const toDelete: string[] = [];

  const payload = (space: string, a: string, b: string, over: Record<string, unknown> = {}) => ({
    client_id: crypto.randomUUID(), space_id: space, description: "Cena", spent_at: "2026-11-10", amount_cents: 1000, currency: "EUR",
    fx_rate: 1, amount_base_cents: 1000, paid_from: "member", split_mode: "equal", is_private: false, tags: [],
    payers: [{ member_id: a, amount_cents: 1000 }], splits: [{ member_id: a, share_bp: 5000, amount_cents: 500 }, { member_id: b, share_bp: 5000, amount_cents: 500 }], ...over,
  });

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva");
    toDelete.push(ana.id, leo.id, eva.id);
    groupId = (await ana.client.rpc("create_space", { p_name: "Viernes noche", p_kind: "group" })).data as string;
    const token = newToken();
    await ana.client.rpc("create_share_link", { p_space: groupId, p_kind: "invite", p_token_hash: await sha256(token), p_ttl_seconds: 3600, p_max_uses: 5 });
    await leo.client.rpc("accept_invite", { p_token_hash: await sha256(token) });
    const { data } = await ana.client.from("space_members").select("id, user_id").eq("space_id", groupId);
    anaMember = data!.find((m) => m.user_id === ana.id)!.id;
    leoMember = data!.find((m) => m.user_id === leo.id)!.id;
    personalId = (await ana.client.from("spaces").select("id").eq("kind", "personal").single()).data!.id;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("las burbujas nuevas traen fondos y categorías por defecto", async () => {
    const { data } = await ana.client.from("categories").select("name").eq("space_id", groupId);
    expect(data!.length).toBeGreaterThanOrEqual(5);
    const { data: p } = await ana.client.from("funds").select("name").eq("space_id", personalId);
    expect(p!.map((f) => f.name)).toContain("Aportación al hogar");
  });

  it("guardar un gasto es atómico e idempotente por client_id", async () => {
    const p = payload(groupId, anaMember, leoMember);
    const a = await ana.client.rpc("save_expense", { p });
    const b = await ana.client.rpc("save_expense", { p });
    expect(a.error).toBeNull();
    expect(b.data).toBe(a.data);
    const { count } = await ana.client.from("expenses").select("id", { count: "exact", head: true }).eq("client_id", p.client_id);
    expect(count).toBe(1);
  });

  it("rechaza importes o repartos que no cuadran, y miembros de otro espacio", async () => {
    expect((await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember, { splits: [{ member_id: anaMember, share_bp: 10000, amount_cents: 900 }] }) })).error).not.toBeNull();
    expect((await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember, { amount_cents: 0, amount_base_cents: 0 }) })).error).not.toBeNull();
    const { data: ev } = await eva.client.from("space_members").select("id").limit(1);
    expect((await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, ev![0]!.id) })).error).not.toBeNull();
  });

  it("un extraño no ve ni crea ni borra gastos del grupo (IDOR)", async () => {
    const created = await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember) });
    const id = created.data as string;
    expect((await eva.client.from("expenses").select("id").eq("id", id)).data).toEqual([]);
    expect((await eva.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember) })).error).not.toBeNull();
    expect((await eva.client.rpc("delete_expense", { p_id: id })).error).not.toBeNull();
    expect((await eva.client.from("expense_splits").select("*").eq("expense_id", id)).data).toEqual([]);
    expect((await eva.client.from("expenses").update({ amount_cents: 1 }).eq("id", id)).error).not.toBeNull();
  });

  it("escritura directa en gastos está prohibida: solo por RPC", async () => {
    const { error } = await ana.client.from("expenses").insert({ space_id: groupId, client_id: crypto.randomUUID(), description: "x", spent_at: "2026-11-10", amount_cents: 1, currency: "EUR", amount_base_cents: 1, created_by_member: anaMember });
    expect(error).not.toBeNull();
  });

  it("gasto privado: los demás ven 'Gasto privado' con importe y reparto; el detalle solo el autor", async () => {
    const { data: id } = await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember, { description: "Regalo sorpresa", is_private: true, tags: ["secreto"] }) });
    const { data: seenByLeo } = await leo.client.from("expenses").select("description, amount_cents").eq("id", id as string).single();
    expect(seenByLeo).toEqual({ description: "Gasto privado", amount_cents: 1000 });
    expect((await leo.client.from("expense_splits").select("amount_cents").eq("expense_id", id as string)).data).toHaveLength(2);
    expect((await leo.client.from("expense_private_details").select("*").eq("expense_id", id as string)).data).toEqual([]);
    const { data: mine } = await ana.client.from("expense_private_details").select("description").eq("expense_id", id as string);
    expect(mine).toEqual([{ description: "Regalo sorpresa" }]);
    expect((await ana.client.from("expense_tags").select("*").eq("expense_id", id as string)).data).toEqual([]);
  });

  it("el gasto personal es invisible para el resto, incluso para miembros de grupos compartidos", async () => {
    const { data: me } = await ana.client.from("space_members").select("id").eq("space_id", personalId).single();
    const { data: id } = await ana.client.rpc("save_expense", { p: payload(personalId, me!.id, me!.id, { splits: [{ member_id: me!.id, share_bp: 10000, amount_cents: 1000 }], payers: [{ member_id: me!.id, amount_cents: 1000 }] }) });
    expect((await leo.client.from("expenses").select("id").eq("id", id as string)).data).toEqual([]);
  });

  it("pago desde el bote solo en hogares, sin pagadores", async () => {
    expect((await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember, { paid_from: "pot", payers: [] }) })).error).not.toBeNull();
    const hh = (await ana.client.rpc("create_space", { p_name: "Casa", p_kind: "household" })).data as string;
    const { data: ms } = await ana.client.from("space_members").select("id").eq("space_id", hh);
    const ok = await ana.client.rpc("save_expense", { p: payload(hh, ms![0]!.id, ms![0]!.id, { paid_from: "pot", payers: [], splits: [{ member_id: ms![0]!.id, share_bp: 10000, amount_cents: 1000 }] }) });
    expect(ok.error).toBeNull();
  });

  it("un invitado solo edita y borra sus propios gastos, y no paga desde el bote", async () => {
    const token = newToken();
    await ana.client.rpc("create_share_link", { p_space: groupId, p_kind: "guest", p_token_hash: await sha256(token), p_ttl_seconds: 3600, p_max_uses: 5 });
    const guest = await createGuest();
    toDelete.push(guest.id);
    await guest.client.rpc("join_as_guest", { p_token_hash: await sha256(token), p_member: null, p_name: "Marta" });
    const { data: gm } = await guest.client.from("space_members").select("id").eq("user_id", guest.id).single();
    const mine = await guest.client.rpc("save_expense", { p: payload(groupId, gm!.id, anaMember) });
    expect(mine.error).toBeNull();
    const others = (await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember) })).data as string;
    expect((await guest.client.rpc("delete_expense", { p_id: others })).error).not.toBeNull();
    expect((await guest.client.rpc("save_expense", { p: { ...payload(groupId, gm!.id, anaMember), id: others } })).error).not.toBeNull();
    expect((await guest.client.rpc("delete_expense", { p_id: mine.data as string })).error).toBeNull();
    expect((await guest.client.rpc("save_income", { p: { space_id: groupId, member_id: gm!.id, amount_cents: 100, received_at: "2026-11-01" } })).error).not.toBeNull();
  });

  it("comentarios y reacciones: solo miembros, como uno mismo, con emoji de la lista blanca", async () => {
    const id = (await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember) })).data as string;
    expect((await leo.client.from("expense_comments").insert({ expense_id: id, space_id: groupId, member_id: leoMember, body: "¡Bien!" })).error).toBeNull();
    expect((await leo.client.from("expense_comments").insert({ expense_id: id, space_id: groupId, member_id: anaMember, body: "Suplantación" })).error).not.toBeNull();
    expect((await eva.client.from("expense_comments").insert({ expense_id: id, space_id: groupId, member_id: leoMember, body: "Intruso" })).error).not.toBeNull();
    expect((await leo.client.from("expense_reactions").insert({ expense_id: id, space_id: groupId, member_id: leoMember, emoji: "👍" })).error).toBeNull();
    expect((await leo.client.from("expense_reactions").insert({ expense_id: id, space_id: groupId, member_id: leoMember, emoji: "💣" })).error).not.toBeNull();
    expect((await eva.client.from("expense_comments").select("*").eq("expense_id", id)).data).toEqual([]);
  });

  it("el historial lo escriben triggers y nadie lo puede editar ni borrar", async () => {
    const id = (await ana.client.rpc("save_expense", { p: payload(groupId, anaMember, leoMember) })).data as string;
    await ana.client.rpc("save_expense", { p: { ...payload(groupId, anaMember, leoMember), id, description: "Cena editada" } });
    const { data } = await ana.client.from("audit_log").select("action").eq("row_id", id).order("id");
    expect(data!.map((r) => r.action)).toEqual(["insert", "update"]);
    expect((await ana.client.from("audit_log").delete().eq("row_id", id)).error).not.toBeNull();
    expect((await ana.client.from("audit_log").insert({ table_name: "x", action: "insert" })).error).not.toBeNull();
    expect((await eva.client.from("audit_log").select("id").eq("row_id", id)).data).toEqual([]);
  });

  it("los favoritos son personales", async () => {
    await ana.client.from("favorites").insert({ user_id: ana.id, space_id: groupId, label: "Café", amount_cents: 250 });
    expect((await leo.client.from("favorites").select("*")).data).toEqual([]);
    expect((await leo.client.from("favorites").insert({ user_id: ana.id, space_id: groupId, label: "Falso", amount_cents: 1 })).error).not.toBeNull();
  });
});
