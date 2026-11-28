"use server";

import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";

/** Sin datos de entrada: marca la pista como vista para quien tiene la sesión. */
export async function dismissSwipeHint(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user && (await allow(RULES.planWrites, data.user.id))) await supabase.rpc("dismiss_swipe_hint");
}
