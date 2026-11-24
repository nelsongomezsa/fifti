import { NextResponse, type NextRequest } from "next/server";
import { addMonths, monthStart, summarizeFund } from "@/lib/money";
import { displayName } from "@/lib/system-names";
import { daysBetween, fixedExpensePayload, usersForLead } from "@/lib/fixed-advance";
import { isCronAuthorized } from "@/lib/security/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPlan } from "@/server/plan";
import { notify } from "@/server/push";

/** Avisos programados (Vercel Cron, una vez al día): fijos de mañana, aportaciones pendientes, fondos al 80/100 % y resumen mensual. */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const admin = createAdminClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const month = monthStart(now);
  const usersOf = async (spaceId: string) =>
    ((await admin.from("space_members").select("user_id").eq("space_id", spaceId).in("role", ["owner", "member"]).not("user_id", "is", null)).data ?? []).map((m) => m.user_id as string);

  try {
    // 1. Gastos fijos que vencen en 1, 3 o 7 días: cada persona recibe el aviso con la antelación que eligió
    const horizon = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const { data: due } = await admin.from("recurring_expenses").select("id, space_id, description, next_run").eq("active", true).gte("next_run", tomorrow).lte("next_run", horizon).limit(2000);
    const dueUsers = new Map<string, string[]>();
    for (const r of due ?? []) if (!dueUsers.has(r.space_id)) dueUsers.set(r.space_id, await usersOf(r.space_id));
    const everyone = [...new Set([...dueUsers.values()].flat())];
    const { data: advPrefs } = everyone.length ? await admin.from("notification_prefs").select("user_id, fixed_advance_days").in("user_id", everyone) : { data: [] };
    const adv = (advPrefs ?? []).map((p) => ({ userId: p.user_id as string, advance: p.fixed_advance_days as number }));
    for (const r of due ?? []) {
      const daysLeft = daysBetween(today, r.next_run);
      await notify(usersForLead(adv, dueUsers.get(r.space_id) ?? [], daysLeft), "fixed_tomorrow", fixedExpensePayload(r.description, daysLeft), `${r.id}:${r.next_run}`);
    }

    // 2. Aportaciones al hogar pendientes (a partir del día 5)
    if (now.getUTCDate() >= 5) {
      const { data: cs } = await admin.from("contributions").select("id, member_id, expected_cents, paid_cents").eq("month", month).limit(2000);
      for (const c of (cs ?? []).filter((x) => x.paid_cents < x.expected_cents && x.expected_cents > 0)) {
        const { data: m } = await admin.from("space_members").select("user_id").eq("id", c.member_id).maybeSingle();
        if (m?.user_id) await notify([m.user_id], "contribution_pending", (t) => ({ title: "Fifti", body: t("Tienes una aportación pendiente al hogar."), url: "/plan" }), c.id);
      }
    }

    // 3. Fondos al 80 % / 100 % del mes
    const { data: plans } = await admin.from("monthly_plans").select("id, space_id").eq("month", month).neq("status", "closed").limit(500);
    for (const p of plans ?? []) {
      const d = await loadPlan(admin, p.space_id, month);
      for (const f of d.funds) {
        const a = d.allocations[f.id];
        const row = summarizeFund(f.id, (a?.planned ?? 0) + (a?.carry ?? 0), d.spentByFund[f.id] ?? 0);
        if (row.planned > 0 && row.status !== "ok") {
          await notify(await usersOf(p.space_id), "fund_threshold",
            (t) => ({ title: "Fifti", body: `${t(row.status === "over" ? "Te has pasado del fondo" : "Vas por el 80 % del fondo")} ${displayName(t, f.name, f.system_key)}.`, url: "/plan" }), `${p.id}:${f.id}:${row.status}`);
        }
      }
    }

    // 4. Resumen mensual (día 1)
    if (today.endsWith("-01")) {
      const { data: profs } = await admin.from("profiles").select("id").limit(5000);
      for (let i = 0; i < (profs ?? []).length; i += 100) {
        await notify(profs!.slice(i, i + 100).map((p) => p.id as string), "monthly_summary", (t) => ({ title: "Fifti", body: t("Tu resumen del mes pasado ya está listo."), url: "/resumen-mensual" }), addMonths(month, -1));
      }
    }
  } catch (err) {
    console.error("[cron notify]", err instanceof Error ? err.message : "error");
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
