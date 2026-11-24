import { describe, expect, it } from "vitest";
import { buildDemoDb } from "@/lib/demo/dataset";
import { createDemoClient, DEMO_ERROR, DEMO_USER_ID } from "@/lib/demo/fake-client";

const db = buildDemoDb(new Date("2026-11-24T10:00:00Z"));
const client = createDemoClient(db);

describe("demo en memoria", () => {
  it("el usuario ficticio es Ana y la demo no pasa por Supabase", async () => {
    const { data } = await client.auth.getUser();
    expect(data.user.id).toBe(DEMO_USER_ID);
    expect(data.user.app_metadata.demo).toBe(true);
  });
  it("lee con filtros, orden, límite y relaciones como PostgREST", async () => {
    const spaces = (await client.from("spaces").select("id, name, kind").is("archived_at", null).order("created_at", { ascending: true })).data as { kind: string }[];
    expect(spaces.map((s) => s.kind)).toEqual(["personal", "household", "group"]);
    const personal = (await client.from("spaces").select("id").eq("kind", "personal").maybeSingle()).data as { id: string };
    const cats = (await client.from("categories").select("name, funds(name, color)").eq("space_id", personal.id)).data as { name: string; funds: { name: string } }[];
    expect(cats.find((c) => c.name === "Alquiler")?.funds.name).toBe("Gastos fijos");
    const last = (await client.from("expenses").select("id, spent_at, expense_splits(member_id, amount_cents)").eq("space_id", personal.id).order("spent_at", { ascending: false }).limit(3)).data as { spent_at: string; expense_splits: unknown[] }[];
    expect(last).toHaveLength(3);
    expect(last[0]!.spent_at >= last[2]!.spent_at).toBe(true);
    expect(last[0]!.expense_splits.length).toBe(1);
  });
  it("los gastos del mes salen del mismo dato que los totales (coherencia)", async () => {
    const personal = (await client.from("spaces").select("id").eq("kind", "personal").maybeSingle()).data as { id: string };
    const rows = (await client.from("expenses").select("amount_base_cents").eq("space_id", personal.id).gte("spent_at", "2026-11-01").lt("spent_at", "2026-12-01")).data as { amount_base_cents: number }[];
    const sum = rows.reduce((a, r) => a + r.amount_base_cents, 0);
    const rpc = (await client.rpc("monthly_spend", { p_space: personal.id, p_from: "2026-11-01" })).data as { month: string; total_cents: number }[];
    expect(rpc.find((r) => r.month === "2026-11-01")?.total_cents).toBe(sum);
  });
  it("no hay gastos en el futuro respecto a hoy", async () => {
    const future = (await client.from("expenses").select("id").gt("spent_at", "2026-11-24")).data as unknown[];
    expect(future).toHaveLength(0);
  });
  it("es de solo lectura: cualquier escritura devuelve «Crea una cuenta para guardar»", async () => {
    for (const r of [await client.from("expenses").insert({}), await client.from("expenses").update({ amount_cents: 1 }).eq("id", "x"), await client.from("expenses").delete().eq("id", "x"), await client.from("expenses").upsert({}), await client.rpc("save_expense", {})]) {
      expect(r.error).toEqual(DEMO_ERROR);
    }
    expect(DEMO_ERROR.message).toBe("Crea una cuenta para guardar");
    expect((db.expenses ?? []).length).toBeGreaterThan(50); // y los datos siguen intactos
  });
  it("datos coherentes por burbuja: en Personal las aportaciones a metas son solo de Ana", async () => {
    const goals = (await client.from("savings_goals").select("id, name, space_id, goal_contributions(member_id, amount_cents)")).data as { name: string; space_id: string; goal_contributions: { member_id: string }[] }[];
    const personal = (await client.from("spaces").select("id").eq("kind", "personal").maybeSingle()).data as { id: string };
    const pMembers = ((await client.from("space_members").select("id").eq("space_id", personal.id)).data as { id: string }[]).map((m) => m.id);
    for (const g of goals.filter((q) => q.space_id === personal.id)) expect(g.goal_contributions.every((c) => pMembers.includes(c.member_id))).toBe(true);
    expect(goals.some((g) => g.name === "Viaje a Japón")).toBe(true);
  });
  it("el reparto de cada gasto suma el total", () => {
    for (const e of (db.expenses ?? []).slice(0, 80)) {
      const sum = (db.expense_splits ?? []).filter((s) => s.expense_id === e.id).reduce((a, s) => a + Number(s.amount_cents), 0);
      expect(sum).toBe(e.amount_cents);
    }
  });
});
