import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tx } from "@/i18n/tx";

/**
 * Para los ingresos de los que salieron aportaciones automáticas, la confirmación que debe pedir su borrado.
 * Los demás no aparecen: se borran con «Deshacer».
 */
export async function incomeConfirms(supabase: SupabaseClient, x: Tx, incomeIds: string[]): Promise<Map<string, { title: string; description: string }>> {
  if (incomeIds.length === 0) return new Map();
  const { data } = await supabase.from("goal_contributions").select("source_income_id, goal_id").in("source_income_id", incomeIds);
  const goals = new Map<string, Set<string>>();
  for (const c of data ?? []) {
    if (!c.source_income_id) continue;
    goals.set(c.source_income_id, (goals.get(c.source_income_id) ?? new Set()).add(c.goal_id));
  }
  return new Map([...goals].map(([id, set]) => [id, {
    title: x("¿Borrar este ingreso?"),
    description: set.size === 1 ? x("Se borrarán también sus aportaciones a 1 meta.") : x("Se borrarán también sus aportaciones a {n} metas.").replace("{n}", String(set.size)),
  }]));
}
