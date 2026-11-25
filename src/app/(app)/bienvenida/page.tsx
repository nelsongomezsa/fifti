import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WelcomePlan } from "@/components/plan/WelcomePlan";
import { getTx } from "@/i18n/tx";
import { monthStart } from "@/lib/money";
import { displayName } from "@/lib/system-names";
import { createClient } from "@/lib/supabase/server";
import { loadPlan } from "@/server/plan";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Configura tu plan" };

/** % sugerido por tipo de fondo: 50 % fijos, 30 % día a día y ocio (20 + 10), 20 % ahorro. */
const SUGGESTED: Record<string, number> = { fixed: 50, variable: 20, leisure: 10, savings: 20 };

export default async function WelcomePage() {
  const [x, user, spaces] = await Promise.all([getTx(), requireUser(), listMySpaces()]);
  const active = await getActiveSpace(spaces);
  if (!active || active.kind === "group" || user.is_anonymous) redirect("/inicio");
  const month = monthStart(new Date());
  const d = await loadPlan(await createClient(), active.id, month);
  const me = d.members.find((m) => m.user_id === user.id);
  if (!me || me.role === "guest") redirect("/inicio");
  // Con el plan ya guardado la persona sigue en el paso 3 (primer gasto fijo); si ya tiene gastos fijos, no hay nada que hacer aquí
  const supabase = await createClient();
  const [{ data: cats }, { data: catRules }] = await Promise.all([
    supabase.from("categories").select("id, name, system_key").eq("space_id", active.id),
    supabase.from("category_rules").select("id, match_text, match_type, category_id, priority").eq("space_id", active.id),
  ]);
  const { count: fixedCount } = await supabase.from("recurring_expenses").select("id", { count: "exact", head: true }).eq("space_id", active.id);
  const { count: accountCount } = await supabase.from("accounts").select("id", { count: "exact", head: true }).eq("space_id", active.id);
  // Plan y gasto fijo hechos: queda el paso opcional de las cuentas; con cuentas creadas ya no hay nada que hacer aquí
  if (d.configured && (fixedCount ?? 0) > 0 && (accountCount ?? 0) > 0) redirect("/inicio");

  const members = [me, ...d.members.filter((m) => m.id !== me.id)].map((m) => ({ id: m.id, name: m.display_name, mine: m.id === me.id }));
  const funds = d.funds.map((f) => ({ id: f.id, name: displayName(x, f.name, f.system_key), color: f.color, suggested: SUGGESTED[f.kind] ?? null }));
  return <WelcomePlan initialStep={d.configured ? ((fixedCount ?? 0) > 0 ? 4 : 3) : 1} categories={(cats ?? []).map((c) => ({ id: c.id, name: displayName(x, c.name, c.system_key) }))} rules={(catRules ?? []).map((r) => ({ id: r.id, matchText: r.match_text, matchType: r.match_type as "contains" | "starts_with" | "exact", categoryId: r.category_id, priority: r.priority }))} spaceId={active.id} month={month} currency="EUR" members={members} funds={funds} />;
}
