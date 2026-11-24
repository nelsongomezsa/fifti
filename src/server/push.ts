import "server-only";
import * as webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { localizePayload, type PushContent } from "@/i18n/push-content";

export type PushKind = "new_expense" | "fixed_tomorrow" | "fund_threshold" | "goal_reached" | "monthly_summary" | "contribution_pending" | "offset_proposal" | "daily_reminder";
let configured = false;
function configure(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.NEXT_PUBLIC_SITE_URL ?? "https://localhost", pub, priv);
  configured = true;
  return true;
}

/**
 * Envía un aviso a esas personas respetando sus preferencias. Con `ref` no se repite el mismo aviso.
 * Los textos son genéricos (sin importes) para no enseñar dinero en la pantalla bloqueada.
 * Nunca lanza: una notificación fallida no debe romper la acción que la provoca.
 */
export async function notify(userIds: string[], kind: PushKind, content: PushContent, ref?: string): Promise<void> {
  try {
    if (userIds.length === 0 || !configure()) return;
    const admin = createAdminClient();
    const { data: prefs } = await admin.from("notification_prefs").select("*").in("user_id", userIds);
    const off = new Set((prefs ?? []).filter((p) => p[kind] === false).map((p) => p.user_id as string));
    let targets = userIds.filter((u) => !off.has(u));
    if (ref && targets.length) {
      const { data: sent } = await admin.from("notification_log").select("user_id").eq("kind", kind).eq("ref", ref).in("user_id", targets);
      const done = new Set((sent ?? []).map((s) => s.user_id as string));
      targets = targets.filter((u) => !done.has(u));
      if (targets.length) await admin.from("notification_log").upsert(targets.map((u) => ({ user_id: u, kind, ref })));
    }
    if (targets.length === 0) return;
    const [{ data: subs }, { data: profs }] = await Promise.all([
      admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", targets),
      admin.from("profiles").select("id, locale").in("id", targets),
    ]);
    const localeOf = new Map((profs ?? []).map((p) => [p.id as string, p.locale as string]));
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        const payload = localizePayload(content, localeOf.get(s.user_id as string));
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
      }
    }));
  } catch (err) {
    console.error("[push]", err instanceof Error ? err.message : "error");
  }
}
