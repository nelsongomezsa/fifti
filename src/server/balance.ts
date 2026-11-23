import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBalances, simplifyDebts, type BalanceExpense, type Transfer } from "@/lib/money";

export type MemberRow = { id: string; user_id: string | null; display_name: string; role: string };
export type SpaceBalance = {
  members: MemberRow[];
  balances: Record<string, number>;
  transfers: Transfer[];
  settlements: { id: string; from_member: string; to_member: string; amount_cents: number; method: string; settled_at: string; offset_id: string | null; created_by: string | null }[];
};

/** Lee todas las páginas de una consulta (PostgREST limita las filas por petición). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error("No se pudieron cargar los datos");
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type ExpRow = {
  paid_from: "member" | "pot";
  expense_payers: { member_id: string; amount_cents: number }[];
  expense_splits: { member_id: string; amount_cents: number }[];
};

/** Saldos de un espacio (opcionalmente solo un rango de fechas: p. ej. un mes para el modo "a cero"). */
export async function loadSpaceBalance(supabase: SupabaseClient, spaceId: string, range?: { from: string; to: string }): Promise<SpaceBalance> {
  const { data: members } = await supabase.from("space_members").select("id, user_id, display_name, role").eq("space_id", spaceId).order("joined_at");
  const expenses = await fetchAll<ExpRow>((a, b) => {
    let q = supabase.from("expenses").select("paid_from, expense_payers(member_id, amount_cents), expense_splits(member_id, amount_cents)").eq("space_id", spaceId);
    if (range) q = q.gte("spent_at", range.from).lt("spent_at", range.to);
    return q.range(a, b) as unknown as PromiseLike<{ data: ExpRow[] | null; error: unknown }>;
  });
  const settlements = await fetchAll<SpaceBalance["settlements"][number]>((a, b) => {
    let q = supabase.from("settlements").select("id, from_member, to_member, amount_cents, method, settled_at, offset_id, created_by").eq("space_id", spaceId);
    if (range) q = q.gte("settled_at", range.from).lt("settled_at", range.to);
    return q.order("settled_at", { ascending: false }).range(a, b) as unknown as PromiseLike<{ data: SpaceBalance["settlements"] | null; error: unknown }>;
  });

  const bx: BalanceExpense[] = expenses.map((e) => ({
    paidFrom: e.paid_from,
    payers: e.expense_payers.map((p) => ({ memberId: p.member_id, amountCents: p.amount_cents })),
    splits: e.expense_splits.map((s) => ({ memberId: s.member_id, amountCents: s.amount_cents })),
  }));
  const ids = (members ?? []).map((m) => m.id);
  const balances = computeBalances(ids, bx, settlements.map((s) => ({ fromMemberId: s.from_member, toMemberId: s.to_member, amountCents: s.amount_cents })));
  return { members: (members ?? []) as MemberRow[], balances, transfers: simplifyDebts(balances), settlements };
}
