import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createGuest, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

describe.skipIf(!rlsConfigured)("RLS fase 2: espacios, invitaciones e invitados", () => {
  let ana: U, leo: U, eva: U;
  let groupId: string;
  const toDelete: string[] = [];

  async function link(user: U, kind: "invite" | "guest", opts?: { ttl?: number; max?: number; space?: string }) {
    const token = newToken();
    const { error } = await user.client.rpc("create_share_link", {
      p_space: opts?.space ?? groupId, p_kind: kind, p_token_hash: await sha256(token),
      p_ttl_seconds: opts?.ttl ?? 3600, p_max_uses: opts?.max ?? 5,
    });
    return { token, hash: await sha256(token), error };
  }

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva");
    toDelete.push(ana.id, leo.id, eva.id);
    const { data, error } = await ana.client.rpc("create_space", { p_name: "Viaje Lisboa", p_kind: "group" });
    expect(error).toBeNull();
    groupId = data as string;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  it("quien crea la burbuja es su owner con 100 % de reparto", async () => {
    const { data } = await ana.client.from("space_members").select("role, default_share_bp").eq("space_id", groupId);
    expect(data).toEqual([{ role: "owner", default_share_bp: 10000 }]);
  });

  it("un extraño no ve la burbuja ni puede crear enlaces ni añadir miembros (IDOR)", async () => {
    const { data } = await leo.client.from("spaces").select("id").eq("id", groupId);
    expect(data).toEqual([]);
    expect((await link(leo, "invite")).error).not.toBeNull();
    const { error } = await leo.client.rpc("add_virtual_member", { p_space: groupId, p_name: "Intruso" });
    expect(error).not.toBeNull();
  });

  it("el hash del token no se puede leer desde el cliente", async () => {
    await link(ana, "invite");
    const { error } = await ana.client.from("share_links").select("token_hash");
    expect(error).not.toBeNull();
    const { error: e2 } = await ana.client.from("space_members").select("claim_token_hash");
    expect(e2).not.toBeNull();
  });

  it("aceptar una invitación: reparto igual y respeta los usos máximos", async () => {
    const l = await link(ana, "invite", { max: 1 });
    expect((await leo.client.rpc("accept_invite", { p_token_hash: l.hash })).error).toBeNull();
    const { data } = await ana.client.from("space_members").select("default_share_bp").eq("space_id", groupId);
    expect(data!.map((m) => m.default_share_bp).sort()).toEqual([5000, 5000]);
    expect((await eva.client.rpc("accept_invite", { p_token_hash: l.hash })).error).not.toBeNull();
  });

  it("enlaces caducados o revocados no sirven", async () => {
    const expired = await link(ana, "invite", { ttl: 60 });
    await admin().from("share_links").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("token_hash", expired.hash);
    expect((await eva.client.rpc("accept_invite", { p_token_hash: expired.hash })).error).not.toBeNull();

    const revoked = await link(ana, "invite");
    const { data } = await ana.client.from("share_links").select("id").eq("space_id", groupId).eq("revoked", false);
    for (const r of data!) await ana.client.rpc("revoke_share_link", { p_link: r.id });
    expect((await eva.client.rpc("accept_invite", { p_token_hash: revoked.hash })).error).not.toBeNull();
  });

  it("el reparto por defecto debe sumar 100 %", async () => {
    const { data: ms } = await ana.client.from("space_members").select("id").eq("space_id", groupId);
    const bad = ms!.map((m, i) => ({ member_id: m.id, bp: i === 0 ? 6000 : 3000 }));
    expect((await ana.client.rpc("set_default_shares", { p_space: groupId, p_shares: bad })).error).not.toBeNull();
    const ok = ms!.map((m, i) => ({ member_id: m.id, bp: i === 0 ? 6000 : 4000 }));
    expect((await ana.client.rpc("set_default_shares", { p_space: groupId, p_shares: ok })).error).toBeNull();
    expect((await leo.client.rpc("set_default_shares", { p_space: groupId, p_shares: ok })).error).not.toBeNull();
  });

  describe("invitados sin cuenta", () => {
    it("entra a un solo grupo y solo ve ese grupo", async () => {
      const l = await link(ana, "guest");
      const guest = await createGuest();
      toDelete.push(guest.id);
      const { error } = await guest.client.rpc("join_as_guest", { p_token_hash: l.hash, p_member: null, p_name: "Marta" });
      expect(error).toBeNull();
      const { data: spaces } = await guest.client.from("spaces").select("id");
      expect(spaces).toEqual([{ id: groupId }]);
      const { data: other } = await guest.client.from("spaces").select("id").neq("id", groupId);
      expect(other).toEqual([]);
      // no puede entrar en un segundo grupo con la misma sesión
      const { data: g2 } = await ana.client.rpc("create_space", { p_name: "Otro plan", p_kind: "group" });
      const l2 = await link(ana, "guest", { space: g2 as string });
      expect((await guest.client.rpc("join_as_guest", { p_token_hash: l2.hash, p_member: null, p_name: "Marta" })).error).not.toBeNull();
    });

    it("no puede crear burbujas, aceptar invitaciones ni gestionar enlaces", async () => {
      const guest = await createGuest();
      toDelete.push(guest.id);
      expect((await guest.client.rpc("create_space", { p_name: "X", p_kind: "group" })).error).not.toBeNull();
      const l = await link(ana, "invite");
      expect((await guest.client.rpc("accept_invite", { p_token_hash: l.hash })).error).not.toBeNull();
      expect((await guest.client.rpc("create_share_link", {
        p_space: groupId, p_kind: "guest", p_token_hash: await sha256(newToken()), p_ttl_seconds: 3600, p_max_uses: 1,
      })).error).not.toBeNull();
    });

    it("un enlace de invitado no vale como invitación con cuenta y viceversa", async () => {
      const inv = await link(ana, "invite");
      const guest = await createGuest();
      toDelete.push(guest.id);
      expect((await guest.client.rpc("join_as_guest", { p_token_hash: inv.hash, p_member: null, p_name: "Nora" })).error).not.toBeNull();
    });

    it("los invitados no entran en espacios fijos", async () => {
      const { data: hh } = await ana.client.rpc("create_space", { p_name: "Casa", p_kind: "household" });
      expect((await link(ana, "guest", { space: hh as string })).error).not.toBeNull();
    });
  });

  it("expulsar deja al miembro como virtual y sin acceso", async () => {
    const { data: ms } = await ana.client.from("space_members").select("id, user_id").eq("space_id", groupId).eq("user_id", leo.id);
    expect((await leo.client.rpc("kick_member", { p_member: ms![0]!.id })).error).not.toBeNull();
    expect((await ana.client.rpc("kick_member", { p_member: ms![0]!.id })).error).toBeNull();
    const { data } = await leo.client.from("spaces").select("id").eq("id", groupId);
    expect(data).toEqual([]);
  });

  it("reclamar perfil: solo con token válido, de un solo uso", async () => {
    const { data: vid } = await ana.client.rpc("add_virtual_member", { p_space: groupId, p_name: "Carla" });
    const token = newToken();
    const hash = await sha256(token);
    expect((await ana.client.rpc("create_claim_link", { p_member: vid, p_token_hash: hash, p_ttl_seconds: 3600 })).error).toBeNull();
    expect((await eva.client.rpc("claim_member", { p_token_hash: await sha256(newToken()) })).error).not.toBeNull();
    expect((await eva.client.rpc("claim_member", { p_token_hash: hash })).error).toBeNull();
    const { data } = await eva.client.from("space_members").select("display_name").eq("space_id", groupId).eq("user_id", eva.id);
    expect(data).toEqual([{ display_name: "Carla" }]);
    expect((await leo.client.rpc("claim_member", { p_token_hash: hash })).error).not.toBeNull();
  });

  it("lookup_share_link solo es accesible con service_role", async () => {
    const l = await link(ana, "guest");
    expect((await leo.client.rpc("lookup_share_link", { p_token_hash: l.hash })).error).not.toBeNull();
    const { data, error } = await admin().rpc("lookup_share_link", { p_token_hash: l.hash });
    expect(error).toBeNull();
    expect(data).toMatchObject({ kind: "guest", space_name: "Viaje Lisboa" });
  });
});
