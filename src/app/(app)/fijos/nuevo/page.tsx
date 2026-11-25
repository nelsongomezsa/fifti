import type { Metadata } from "next";
import Link from "next/link";
import { NewFixedExpense } from "@/components/plan/NewFixedExpense";
import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import { createClient } from "@/lib/supabase/server";
import { loadAccounts } from "@/server/accounts";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Nuevo gasto fijo" };

export default async function NewFixedPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const x = await getTx();
  const user = await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active) return null;
  const sp = await searchParams;
  const supabase = await createClient();
  const editing = sp.id && /^[0-9a-f-]{36}$/i.test(sp.id) ? (await supabase.from("recurring_expenses").select("id, description, amount_cents, frequency, day, category_id").eq("id", sp.id).eq("space_id", active.id).maybeSingle()).data : null;
  const [{ data: cats }, { data: rules }, { data: prefs }] = await Promise.all([
    supabase.from("categories").select("id, name, system_key").eq("space_id", active.id).order("name"),
    supabase.from("category_rules").select("id, match_text, match_type, category_id, priority").eq("space_id", active.id),
    user.is_anonymous ? Promise.resolve({ data: null }) : supabase.from("notification_prefs").select("fixed_tomorrow, fixed_advance_days").maybeSingle(),
  ]);
  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/plan?vista=fijos" className="flex min-h-11 items-center self-start text-sm text-ink-2">‹ {x("Plan")}</Link>
      <h1 className="text-2xl font-bold">{editing ? x("Editar gasto fijo") : x("Nuevo gasto fijo")}</h1>
      <NewFixedExpense
        spaceId={active.id}
        accounts={(await loadAccounts(supabase, user.id)).filter((a) => a.spaceId === active.id).map((a) => ({ id: a.id, name: a.name, isDefault: a.mine && a.isDefault }))}
        categories={(cats ?? []).map((c) => ({ id: c.id, name: displayName(x, c.name, c.system_key) }))}
        rules={(rules ?? []).map((r) => ({ id: r.id, matchText: r.match_text, matchType: r.match_type as "contains" | "starts_with" | "exact", categoryId: r.category_id, priority: r.priority }))}
        initial={editing ? { id: editing.id, description: editing.description, cents: editing.amount_cents, freq: editing.frequency as "weekly" | "monthly" | "quarterly" | "yearly", day: editing.day, category: editing.category_id ?? "" } : undefined}
        notify={{ on: prefs?.fixed_tomorrow ?? true, days: prefs?.fixed_advance_days ?? 1 }}
      />
    </section>
  );
}
