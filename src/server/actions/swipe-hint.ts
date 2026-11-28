"use server";

import { createClient } from "@/lib/supabase/server";

/** Sin datos de entrada: marca la pista como vista para quien tiene la sesión. */
export async function dismissSwipeHint(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) await supabase.rpc("dismiss_swipe_hint");
}
