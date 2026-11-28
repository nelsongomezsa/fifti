import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Sb = Awaited<ReturnType<typeof createClient>>;
export type AccountKind = "payroll" | "daily" | "savings" | "shared";
export type AccountRow = { id: string; spaceId: string; name: string; bank: string | null; color: string; kind: AccountKind; openingCents: number; openingDate: string; isDefault: boolean; archived: boolean; mine: boolean; balanceCents: number; currency: string };

/** Cuentas visibles (las propias y las comunes de sus espacios) con su saldo: dos consultas a la vez. */
export async function loadAccounts(supabase: Sb, uid: string, withArchived = false): Promise<AccountRow[]> {
  const [{ data: rows }, { data: bal }] = await Promise.all([
    supabase.from("accounts").select("id, space_id, name, bank, color, kind, opening_cents, opening_date, is_default, archived_at, owner_user_id, currency").order("created_at"),
    supabase.rpc("account_balances"),
  ]);
  const b = new Map(((bal ?? []) as { account_id: string; balance_cents: number }[]).map((r) => [r.account_id, Number(r.balance_cents)]));
  return (rows ?? []).filter((r) => withArchived || !r.archived_at).map((r) => ({
    id: r.id, spaceId: r.space_id, name: r.name, bank: r.bank, color: r.color, kind: r.kind as AccountKind, openingCents: Number(r.opening_cents), openingDate: r.opening_date,
    isDefault: r.is_default, archived: !!r.archived_at, mine: r.owner_user_id === uid, balanceCents: b.get(r.id) ?? 0, currency: r.currency ?? "EUR",
  }));
}
