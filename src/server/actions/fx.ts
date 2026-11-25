"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isCurrency } from "@/lib/fx";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { resolveFx } from "@/server/fx";

/** Vista previa del cambio para la hoja de gasto (solo usuarios con sesión). */
export async function getFxPreview(base: string, from: string, date: string): Promise<number | null> {
  const ok = z.strictObject({ base: z.string().length(3), from: z.string().length(3), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse({ base, from, date });
  if (!ok.success || !isCurrency(base) || !isCurrency(from)) return null;
  const { data } = await (await createClient()).auth.getUser();
  if (!data.user) return null;
  if (!(await allow(RULES.comment, data.user.id))) return null;
  return resolveFx(base, from, date);
}
