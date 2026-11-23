"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./auth";

const subSchema = z
  .object({
    endpoint: z.url().refine((u) => u.startsWith("https://") && u.length <= 1000, "Endpoint no válido"),
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }).strict(),
  })
  .strict();

export async function savePushSubscription(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = subSchema.safeParse(JSON.parse(JSON.stringify(input ?? {})));
  if (!parsed.success) return { ok: false, error: "Suscripción no válida" };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) return { ok: false, error: "Necesitas una cuenta." };
  const { count } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 10) return { ok: false, error: "Demasiados dispositivos." };
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: data.user.id, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth }, { onConflict: "endpoint" });
  return error ? { ok: false, error: "No se ha podido activar." } : { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return;
  const supabase = await createClient();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

const KEYS = ["new_expense", "fixed_tomorrow", "fund_threshold", "goal_reached", "monthly_summary", "contribution_pending", "offset_proposal"] as const;

export async function savePrefs(_prev: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Sesión caducada." };
  const row: Record<string, boolean | string> = { user_id: data.user.id };
  for (const k of KEYS) row[k] = fd.get(k) === "on";
  const { error } = await supabase.from("notification_prefs").upsert(row, { onConflict: "user_id" });
  if (error) return { error: "No se ha podido guardar." };
  revalidatePath("/mas");
  return { ok: true, message: "Preferencias guardadas." };
}
