import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, newToken, rlsConfigured, sha256 } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
const today = () => new Date().toISOString().slice(0, 10);

describe.skipIf(!rlsConfigured)("RLS fase 5: compra, préstamos y turnos", () => {
  let ana: U, leo: U, eva: U, marta: U;
  let home: string, anaM: string, leoM: string;
  const toDelete: string[] = [];

  beforeAll(async () => {
    ana = await createUser("Ana"); leo = await createUser("Leo"); eva = await createUser("Eva"); marta = await createUser("Marta");
    toDelete.push(ana.id, leo.id, eva.id, marta.id);
    home = (await ana.client.rpc("create_space", { p_name: "Casa de Ana y Leo", p_kind: "household" })).data as string;
    const t = newToken();
    await ana.client.rpc("create_share_link", { p_space: home, p_kind: "invite", p_token_hash: await sha256(t), p_ttl_seconds: 3600, p_max_uses: 1 });
    await leo.client.rpc("accept_invite", { p_token_hash: await sha256(t) });
    const ms = (await ana.client.from("space_members").select("id, user_id").eq("space_id", home)).data!;
    anaM = ms.find((m) => m.user_id === ana.id)!.id; leoM = ms.find((m) => m.user_id === leo.id)!.id;
  });
  afterAll(async () => { for (const id of toDelete) await admin().auth.admin.deleteUser(id); });

  describe("lista de la compra", () => {
    let list: string;
    it("un miembro crea la lista y añade; el otro la ve y marca; un ajeno no ve nada", async () => {
      const r = await ana.client.rpc("ensure_shopping_list", { p_space: home });
      expect(r.error).toBeNull(); list = r.data as string;
      expect((await ana.client.rpc("ensure_shopping_list", { p_space: home })).data).toBe(list);
      expect((await ana.client.from("shopping_items").insert({ list_id: list, space_id: home, text: "Leche", quantity: 2 })).error).toBeNull();
      expect((await ana.client.from("shopping_items").insert({ list_id: list, space_id: home, text: "Pan" })).error).toBeNull();
      const items = (await leo.client.from("shopping_items").select("id, text").eq("space_id", home)).data!;
      expect(items).toHaveLength(2);
      expect((await leo.client.from("shopping_items").update({ checked: true }).eq("id", items.find((i) => i.text === "Leche")!.id)).error).toBeNull();
      expect((await eva.client.from("shopping_items").select("id").eq("space_id", home)).data).toEqual([]);
      expect((await eva.client.from("shopping_items").insert({ list_id: list, space_id: home, text: "Hack" })).error).not.toBeNull();
      expect((await eva.client.rpc("ensure_shopping_list", { p_space: home })).error).not.toBeNull();
    });
    it("valida texto, cantidad y que la lista sea de la burbuja", async () => {
      expect((await ana.client.from("shopping_items").insert({ list_id: list, space_id: home, text: "" })).error).not.toBeNull();
      expect((await ana.client.from("shopping_items").insert({ list_id: list, space_id: home, text: "x".repeat(121) })).error).not.toBeNull();
      expect((await ana.client.from("shopping_items").insert({ list_id: list, space_id: home, text: "Ok", quantity: 0 })).error).not.toBeNull();
      const personal = (await ana.client.from("spaces").select("id").eq("kind", "personal")).data![0]!.id;
      expect((await ana.client.from("shopping_items").insert({ list_id: list, space_id: personal, text: "Mezcla" })).error).not.toBeNull();
      expect((await ana.client.rpc("ensure_shopping_list", { p_space: personal })).error).not.toBeNull();
    });
    it("terminar la compra archiva lo marcado y pasa lo pendiente a la lista nueva", async () => {
      const exp = (await ana.client.rpc("save_expense", { p: {
        client_id: crypto.randomUUID(), space_id: home, description: "Compra", spent_at: today(), amount_cents: 1000, currency: "EUR", fx_rate: 1, amount_base_cents: 1000,
        paid_from: "member", split_mode: "equal", is_private: false, tags: [], payers: [{ member_id: anaM, amount_cents: 1000 }],
        splits: [{ member_id: anaM, share_bp: 5000, amount_cents: 500 }, { member_id: leoM, share_bp: 5000, amount_cents: 500 }],
      } })).data as string;
      expect((await eva.client.rpc("finish_shopping", { p_space: home, p_expense: exp })).error).not.toBeNull();
      const names = await ana.client.rpc("finish_shopping", { p_space: home, p_expense: exp });
      expect(names.data).toBe("Leche x2");
      const left = (await ana.client.from("shopping_items").select("text, list_id").eq("space_id", home)).data!;
      expect(left.find((i) => i.text === "Leche")!.list_id).toBe(list); // lo marcado queda en la lista cerrada
      expect(left.find((i) => i.text === "Pan")!.list_id).not.toBe(list); // lo pendiente pasa a la nueva
    });
  });

  describe("préstamos", () => {
    let loan: string;
    it("son privados de quien los crea", async () => {
      const ins = await ana.client.from("loans").insert({ direction: "lent", person_name: "Marta", amount_cents: 5000 }).select("id").single();
      expect(ins.error).toBeNull(); loan = ins.data!.id;
      expect((await leo.client.from("loans").select("id")).data).toEqual([]);
      expect((await leo.client.from("loans").update({ amount_cents: 1 }).eq("id", loan)).data).toBeNull();
      expect((await ana.client.from("loans").select("amount_cents").eq("id", loan)).data).toEqual([{ amount_cents: 5000 }]);
    });
    it("solo se vincula a quien comparte burbuja; y solo ve el préstamo si el creador lo comparte", async () => {
      expect((await ana.client.from("loans").insert({ direction: "lent", person_name: "Eva", amount_cents: 100, linked_user_id: eva.id })).error).not.toBeNull();
      expect((await ana.client.from("loans").insert({ direction: "lent", person_name: "Leo", amount_cents: 100, shared: true })).error).not.toBeNull(); // shared sin vínculo
      const priv = await ana.client.from("loans").insert({ direction: "lent", person_name: "Leo", amount_cents: 700, linked_user_id: leo.id, shared: false }).select("id").single();
      expect((await leo.client.from("loans").select("id").eq("id", priv.data!.id)).data).toEqual([]);
      const shared = await ana.client.from("loans").insert({ direction: "lent", person_name: "Leo", amount_cents: 800, linked_user_id: leo.id, shared: true }).select("id").single();
      expect((await leo.client.from("loans").select("amount_cents").eq("id", shared.data!.id)).data).toEqual([{ amount_cents: 800 }]);
      expect((await eva.client.from("loans").select("id").eq("id", shared.data!.id)).data).toEqual([]);
      expect((await leo.client.from("loans").update({ amount_cents: 1 }).eq("id", shared.data!.id).select()).data).toEqual([]); // quien lo ve no lo edita
    });
    it("devoluciones parciales y totales sin pasarse", async () => {
      expect((await ana.client.from("loan_repayments").insert({ loan_id: loan, amount_cents: 2000 })).error).toBeNull();
      expect((await ana.client.from("loan_repayments").insert({ loan_id: loan, amount_cents: 3001 })).error).not.toBeNull();
      expect((await ana.client.from("loan_repayments").insert({ loan_id: loan, amount_cents: 3000 })).error).toBeNull();
      expect((await leo.client.from("loan_repayments").insert({ loan_id: loan, amount_cents: 1 })).error).not.toBeNull();
      expect((await leo.client.from("loan_repayments").select("id").eq("loan_id", loan)).data).toEqual([]);
    });
  });

  describe("turnos", () => {
    let rec: string;
    const payload = (rotation: string[]) => ({ space_id: home, description: "Limpieza", amount_cents: 6000, frequency: "monthly", day: 1, next_run: today(), paid_from: "member", rotation });
    it("valida la rotación", async () => {
      expect((await ana.client.rpc("save_recurring", { p: payload([anaM]) })).error).not.toBeNull(); // un solo miembro
      expect((await ana.client.rpc("save_recurring", { p: payload([anaM, anaM]) })).error).not.toBeNull(); // repetido
      expect((await ana.client.rpc("save_recurring", { p: payload([anaM, crypto.randomUUID()]) })).error).not.toBeNull(); // ajeno
      const personal = (await ana.client.from("spaces").select("id").eq("kind", "personal")).data![0]!.id;
      expect((await ana.client.rpc("save_recurring", { p: { ...payload([anaM, leoM]), space_id: personal } })).error).not.toBeNull();
    });
    it("cada mes paga quien toca", async () => {
      const r = await ana.client.rpc("save_recurring", { p: payload([anaM, leoM]) });
      expect(r.error).toBeNull(); rec = r.data as string;
      const paid: string[] = [];
      for (let i = 0; i < 3; i++) {
        await admin().from("recurring_expenses").update({ next_run: today() }).eq("id", rec);
        await admin().rpc("process_recurring");
        const { data } = await admin().from("expenses").select("id, spent_at, created_at").eq("recurring_id", rec).order("created_at", { ascending: false }).limit(1);
        const p = await admin().from("expense_payers").select("member_id").eq("expense_id", data![0]!.id);
        paid.push(p.data![0]!.member_id);
        await admin().from("expenses").update({ recurring_id: null }).eq("id", data![0]!.id); // para distinguir el siguiente
      }
      expect(paid).toEqual([anaM, leoM, anaM]);
    });
    it("un ajeno no puede cambiar el gasto fijo", async () => {
      expect((await eva.client.rpc("save_recurring", { p: { ...payload([anaM, leoM]), id: rec } })).error).not.toBeNull();
    });
  });
});
