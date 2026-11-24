import { NextResponse, type NextRequest } from "next/server";
import { shouldRemind } from "@/lib/reminder";
import { isCronAuthorized } from "@/lib/security/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/server/push";

/** Cada hora (pg_cron + pg_net de Supabase): avisa a quien tenga activado el recordatorio a esta hora local y aún no haya apuntado nada hoy. */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const admin = createAdminClient();
  const now = new Date();
  try {
    const { data: prefs } = await admin.from("notification_prefs").select("user_id, reminder_hour, timezone").eq("daily_reminder", true).limit(5000);
    const hourly = (prefs ?? []).filter((p) => shouldRemind({ reminderHour: p.reminder_hour, timezone: p.timezone }, now, [])?.remind);
    if (hourly.length === 0) return NextResponse.json({ ok: true, sent: 0 });

    const ids = hourly.map((p) => p.user_id as string);
    const { data: members } = await admin.from("space_members").select("id, user_id").in("user_id", ids);
    const userOf = new Map((members ?? []).map((m) => [m.id as string, m.user_id as string]));
    const since = new Date(now.getTime() - 36 * 3600_000).toISOString();
    const { data: made } = userOf.size ? await admin.from("expenses").select("created_by_member, created_at").in("created_by_member", [...userOf.keys()]).gte("created_at", since).limit(20000) : { data: [] };
    const byUser = new Map<string, Date[]>();
    for (const e of made ?? []) { const u = userOf.get(e.created_by_member as string); if (u) byUser.set(u, [...(byUser.get(u) ?? []), new Date(e.created_at as string)]); }

    let sent = 0;
    for (const p of hourly) {
      const r = shouldRemind({ reminderHour: p.reminder_hour, timezone: p.timezone }, now, byUser.get(p.user_id as string) ?? []);
      if (!r?.remind) continue;
      // Texto genérico, sin importes; `ref` evita repetirlo el mismo día local
      await notify([p.user_id as string], "daily_reminder", (t) => ({ title: "Fifti", body: t("¿Has apuntado hoy tus gastos?"), url: "/inicio?nuevo=gasto" }), r.ymd);
      sent++;
    }
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    console.error("[cron reminders]", err instanceof Error ? err.message : "error");
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
