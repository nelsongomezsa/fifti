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
  if (d.configured) redirect("/plan");

  const members = [me, ...d.members.filter((m) => m.id !== me.id)].map((m) => ({ id: m.id, name: m.display_name, mine: m.id === me.id }));
  const funds = d.funds.map((f) => ({ id: f.id, name: displayName(x, f.name, f.system_key), color: f.color, suggested: SUGGESTED[f.kind] ?? null }));
  return <WelcomePlan spaceId={active.id} month={month} currency="EUR" members={members} funds={funds} />;
}
