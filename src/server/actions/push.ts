"use server";

import { getTx } from "@/i18n/tx";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toAdvance } from "@/lib/fixed-advance";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

const subSchema = z
  .object({
    endpoint: z.url().refine((u) => u.startsWith("https://") && u.length <= 1000, "Endpoint no válido"),
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }).strict(),
  })
  .strict();

export async function savePushSubscription(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const x = await getTx();
  const parsed = subSchema.safeParse(JSON.parse(JSON.stringify(input ?? {})));
  if (!parsed.success) return { ok: false, error: x("Suscripción no válida") };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) return { ok: false, error: x("Necesitas una cuenta.") };
  const { count } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 10) return { ok: false, error: x("Demasiados dispositivos.") };
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: data.user.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth }, { onConflict: "endpoint" });
  return error ? { ok: false, error: x("No se ha podido activar.") } : { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return;
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

const KEYS = ["new_expense", "fixed_tomorrow", "fund_threshold", "goal_reached", "monthly_summary", "contribution_pending", "offset_proposal"] as const;

const reminderSchema = z.object({
  hour: z.number().int().min(0).max(23),
  timezone: z.string().max(64).refine((tz) => { try { new Intl.DateTimeFormat("es", { timeZone: tz }); return true; } catch { return false; } }),
}).strict();

export async function savePrefs(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: x("Sesión caducada.") };
  const row: Record<string, boolean | string | number> = { user_id: data.user.id };
  for (const k of KEYS) row[k] = fd.get(k) === "on";
  const rem = reminderSchema.safeParse({ hour: Number(fd.get("reminder_hour") ?? 21), timezone: String(fd.get("timezone") || "Europe/Madrid") });
  if (!rem.success) return { error: x("Hora o zona horaria no válida.") };
  row.fixed_advance_days = toAdvance(Number(fd.get("fixed_advance_days") ?? 1));
  row.daily_reminder = fd.get("daily_reminder") === "on";
  row.reminder_hour = rem.data.hour;
  row.timezone = rem.data.timezone;
  const { error } = await supabase.from("notification_prefs").upsert(row, { onConflict: "user_id" });
  if (error) return { error: x("No se ha podido guardar.") };
  revalidatePath("/ajustes");
  return { ok: true, message: x("Preferencias guardadas.") };
}
