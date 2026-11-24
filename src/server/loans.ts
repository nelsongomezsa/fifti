import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LoanRow = {
  id: string; direction: "lent" | "borrowed"; personName: string; amountCents: number; remainingCents: number; loanDate: string;
  remindOn: string | null; note: string | null; shared: boolean; mine: boolean; creatorName?: string;
};

/** Préstamos visibles para esta persona (RLS): los suyos y los que otra persona ha compartido explícitamente con ella. */
export async function loadLoans(supabase: SupabaseClient, uid: string): Promise<LoanRow[]> {
  const [{ data: loans }, { data: reps }] = await Promise.all([
    supabase.from("loans").select("id, user_id, direction, person_name, amount_cents, loan_date, remind_on, note, shared").order("loan_date", { ascending: false }).limit(200),
    supabase.from("loan_repayments").select("loan_id, amount_cents").limit(2000),
  ]);
  const paid = new Map<string, number>();
  for (const r of reps ?? []) paid.set(r.loan_id, (paid.get(r.loan_id) ?? 0) + r.amount_cents);
  return (loans ?? []).map((l) => {
    const mine = l.user_id === uid;
    // Visto desde quien lo recibe, la dirección se invierte
    const direction = mine ? (l.direction as "lent" | "borrowed") : l.direction === "lent" ? "borrowed" : "lent";
    return { id: l.id, direction, personName: l.person_name, amountCents: l.amount_cents, remainingCents: l.amount_cents - (paid.get(l.id) ?? 0), loanDate: l.loan_date, remindOn: l.remind_on, note: l.note, shared: l.shared, mine };
  });
}

/** "Te deben X · Debes Y": solo con lo propio y lo que queda por devolver. */
export function loanTotals(rows: LoanRow[]) {
  const own = rows.filter((r) => r.mine && r.remainingCents > 0);
  return {
    owedToMe: own.filter((r) => r.direction === "lent").reduce((a, r) => a + r.remainingCents, 0),
    iOwe: own.filter((r) => r.direction === "borrowed").reduce((a, r) => a + r.remainingCents, 0),
    due: own.filter((r) => r.remindOn && r.remindOn <= new Date().toISOString().slice(0, 10)).length,
  };
}
