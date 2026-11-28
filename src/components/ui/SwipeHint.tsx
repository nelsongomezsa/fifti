import { SwipeHintBanner } from "@/components/ui/SwipeHintBanner";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/spaces";

/** Se pone encima de una lista que se puede deslizar. */
export async function SwipeHint() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("swipe_hint_at").eq("id", user.id).maybeSingle();
  return data && !data.swipe_hint_at ? <SwipeHintBanner /> : null;
}
