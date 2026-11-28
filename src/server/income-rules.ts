import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomeRule, PayFrequency } from "@/lib/paydays";

/** Ingresos que se repiten de un espacio y sus cobros saltados. Todo por RLS. */
export async function loadIncomeRules(supabase: SupabaseClient, spaceId: string): Promise<{ rules: IncomeRule[]; skips: Set<string> }> {
  const { data } = await supabase.from("income_rules").select("id, member_id, source, amount_cents, currency, account_id, frequency, day, day2, next_run, active").eq("space_id", spaceId).order("next_run");
  const rules: IncomeRule[] = (data ?? []).map((r) => ({
    id: r.id, memberId: r.member_id, source: r.source, amountCents: r.amount_cents, currency: r.currency, accountId: r.account_id,
    frequency: r.frequency as PayFrequency, day: r.day, day2: r.day2, nextRun: r.next_run, active: r.active,
  }));
  if (rules.length === 0) return { rules, skips: new Set() };
  const { data: skipRows } = await supabase.from("income_skips").select("rule_id, skip_on").in("rule_id", rules.map((r) => r.id));
  return { rules, skips: new Set((skipRows ?? []).map((s) => `${s.rule_id}|${s.skip_on}`)) };
}
