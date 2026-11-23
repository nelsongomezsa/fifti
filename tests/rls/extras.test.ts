import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
const webp = () => new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], { type: "image/webp" });

describe.skipIf(!rlsConfigured)("RLS fase 10: tickets, push y preferencias", () => {
  let ana: U, leo: U, eva: U;
  let group: string, anaM: string, leoM: string;
  const toDelete: string[] = [];
  const exp = (over: Record<string, unknown> = {}) => ({
    client_id: crypto.randomUUID(), space_id: group, description: "Cena", spent_at: "2026-11-10", amount_cents: 1000, currency: "EUR", fx_rate: 1, amount_base_cents: 1000,
    paid_from: "member", split_mode: "equal", is_private: false, tags: [],
    payers: [{ member_id: anaM, amount_cents: 1000 }], splits: [{ member_id: anaM, share_bp: 5000, amount_cents: 500 }, { member_id: leoM, share_bp: 5000, amount_cents: 500 }], ...over,
  });

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva"); toDelete.push(ana.id, leo.id, eva.id);
    group = (await ana.client.rpc("create_space", { p_name: "Viernes noche", p_kind: "group" })).data as string;
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: group, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 2 });
    await leo.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
    const ms = (await ana.client.from("space_members").select("id, user_id").eq("space_id", group)).data!;
    anaM = ms.find((m) => m.user_id === ana.id)!.id; leoM = ms.find((m) => m.user_id === leo.id)!.id;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("el bucket de tickets es privado, con tope de 5 MB y solo webp", async () => {
    const { data } = await admin().storage.getBucket("receipts");
    expect(data).toMatchObject({ public: false, file_size_limit: 5242880 });
    expect(data!.allowed_mime_types).toEqual(["image/webp"]);
  });

  it("solo los miembros suben y ven tickets de su espacio; nombres fuera de patrón se rechazan", async () => {
    const path = `${group}/${crypto.randomUUID()}.webp`;
    expect((await ana.client.storage.from("receipts").upload(path, webp(), { contentType: "image/webp" })).error).toBeNull();
    expect((await eva.client.storage.from("receipts").upload(`${group}/${crypto.randomUUID()}.webp`, webp(), { contentType: "image/webp" })).error).not.toBeNull();
    expect((await ana.client.storage.from("receipts").upload(`${group}/nombre-que-yo-elijo.webp`, webp(), { contentType: "image/webp" })).error).not.toBeNull();
    expect((await ana.client.storage.from("receipts").upload(`${group}/${crypto.randomUUID()}.png`, webp(), { contentType: "image/png" })).error).not.toBeNull();
    expect((await leo.client.storage.from("receipts").createSignedUrl(path, 60)).data?.signedUrl).toBeTruthy();
    expect((await eva.client.storage.from("receipts").createSignedUrl(path, 60)).data?.signedUrl).toBeFalsy();
    expect((await eva.client.storage.from("receipts").download(path)).error).not.toBeNull();
    expect((await leo.client.storage.from("receipts").remove([path])).data ?? []).toHaveLength(0); // solo borra quien lo subió
  });

  it("attach_receipt: ruta del propio espacio, solo quien puede editar; privados solo el autor", async () => {
    const { data: id } = await ana.client.rpc("save_expense", { p: exp() });
    const good = `${group}/${crypto.randomUUID()}.webp`;
    expect((await ana.client.rpc("attach_receipt", { p_expense: id, p_path: good })).error).toBeNull();
    expect((await ana.client.rpc("attach_receipt", { p_expense: id, p_path: `${crypto.randomUUID()}/${crypto.randomUUID()}.webp` })).error).not.toBeNull(); // otro espacio
    expect((await ana.client.rpc("attach_receipt", { p_expense: id, p_path: `${group}/../${crypto.randomUUID()}.webp` })).error).not.toBeNull();
    expect((await eva.client.rpc("attach_receipt", { p_expense: id, p_path: good })).error).not.toBeNull();
    const { data: priv } = await ana.client.rpc("save_expense", { p: exp({ is_private: true }) });
    expect((await leo.client.rpc("attach_receipt", { p_expense: priv, p_path: good })).error).not.toBeNull();
    expect((await ana.client.rpc("attach_receipt", { p_expense: priv, p_path: good })).error).toBeNull();
    expect((await leo.client.from("expense_private_details").select("receipt_path").eq("expense_id", priv as string)).data).toEqual([]);
  });

  it("un invitado solo adjunta tickets a sus propios gastos", async () => {
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: group, p_kind: "guest", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 2 });
    const g = await createGuest(); toDelete.push(g.id);
    await g.client.rpc("join_as_guest", { p_token_hash: await sha256(t), p_member: null, p_name: "Marta" });
    const { data: other } = await ana.client.rpc("save_expense", { p: exp() });
    expect((await g.client.rpc("attach_receipt", { p_expense: other, p_path: `${group}/${crypto.randomUUID()}.webp` })).error).not.toBeNull();
  });

  it("suscripciones push: solo las propias, solo https, y no para invitados", async () => {
    const sub = { endpoint: "https://push.example.test/abc", p256dh: "p".repeat(40), auth: "a".repeat(16) };
    expect((await ana.client.from("push_subscriptions").insert({ user_id: ana.id, ...sub })).error).toBeNull();
    expect((await leo.client.from("push_subscriptions").select("*")).data).toEqual([]);
    expect((await leo.client.from("push_subscriptions").insert({ user_id: ana.id, ...sub, endpoint: "https://push.example.test/x" })).error).not.toBeNull();
    expect((await ana.client.from("push_subscriptions").insert({ user_id: ana.id, ...sub, endpoint: "http://push.example.test/insecure" })).error).not.toBeNull();
    const g = await createGuest(); toDelete.push(g.id);
    expect((await g.client.from("push_subscriptions").insert({ user_id: g.id, ...sub, endpoint: "https://push.example.test/guest" })).error).not.toBeNull();
    expect((await leo.client.from("push_subscriptions").delete().eq("endpoint", sub.endpoint)).data).toBeNull();
    expect((await ana.client.from("push_subscriptions").select("id").eq("endpoint", sub.endpoint)).data).toHaveLength(1);
  });

  it("preferencias y registro de avisos", async () => {
    expect((await ana.client.from("notification_prefs").upsert({ user_id: ana.id, new_expense: false })).error).toBeNull();
    expect((await leo.client.from("notification_prefs").select("*").eq("user_id", ana.id)).data).toEqual([]);
    expect((await leo.client.from("notification_prefs").upsert({ user_id: ana.id, new_expense: true })).error).not.toBeNull();
    expect((await ana.client.from("notification_log").select("*")).data ?? []).toEqual([]);
    expect((await ana.client.from("notification_log").insert({ user_id: ana.id, kind: "x", ref: "y" })).error).not.toBeNull();
  });
});
