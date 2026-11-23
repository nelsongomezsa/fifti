"use server";

import { createClient } from "@/lib/supabase/server";
import { isCurrency } from "@/lib/fx";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { resolveFx } from "@/server/fx";

/** Vista previa del cambio para la hoja de gasto (solo usuarios con sesión). */
export async function getFxPreview(base: string, from: string, date: string): Promise<number | null> {
  if (!isCurrency(base) || !isCurrency(from)) return null;
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return null;
  if (!(await allow(RULES.comment, data.user.id))) return null;
  return resolveFx(base, from, date);
}
