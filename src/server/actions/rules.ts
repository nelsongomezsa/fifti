"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { rpcMessage } from "@/server/rpc-error";
import type { FormState } from "./auth";

const ruleSchema = z.object({
  spaceId: uuidSchema,
  matchText: z.string().trim().min(1).max(60),
  matchType: z.enum(["contains", "starts_with", "exact"]),
  categoryId: uuidSchema,
}).strict();
const updateSchema = ruleSchema.extend({ id: uuidSchema }).strict();
const moveSchema = z.object({ spaceId: uuidSchema, id: uuidSchema, dir: z.enum(["up", "down"]) }).strict();
const deleteSchema = z.object({ spaceId: uuidSchema, id: uuidSchema }).strict();
const acceptSchema = z.object({ spaceId: uuidSchema, text: z.string().trim().min(1).max(60), categoryId: uuidSchema }).strict();

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}
const fd2obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$ACTION")).map(([k, v]) => [k, typeof v === "string" ? v : ""]));

export async function createRule(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const p = ruleSchema.safeParse(fd2obj(fd));
  if (!p.success) return { error: x("Datos no válidos") };
  const { supabase, user } = await session();
  if (!user) return { error: x("Sesión caducada.") };
  if (!(await allow(RULES.rules, user.id))) return { error: x("Demasiados intentos. Espera un rato.") };
  const { data: last } = await supabase.from("category_rules").select("priority").eq("space_id", p.data.spaceId).order("priority", { ascending: false }).limit(1);
  const { error } = await supabase.from("category_rules").insert({
    space_id: p.data.spaceId, match_text: p.data.matchText, match_type: p.data.matchType, category_id: p.data.categoryId, priority: (last?.[0]?.priority ?? 0) + 10,
  });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/reglas");
  return { message: x("Regla creada.") };
}

export async function updateRule(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const p = updateSchema.safeParse(fd2obj(fd));
  if (!p.success) return { error: x("Datos no válidos") };
  const { supabase, user } = await session();
  if (!user) return { error: x("Sesión caducada.") };
  if (!(await allow(RULES.rules, user.id))) return { error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.from("category_rules").update({ match_text: p.data.matchText, match_type: p.data.matchType, category_id: p.data.categoryId }).eq("id", p.data.id).eq("space_id", p.data.spaceId);
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/reglas");
  return { message: x("Regla guardada.") };
}

export async function deleteRule(fd: FormData) {
  const p = deleteSchema.safeParse(fd2obj(fd));
  const { supabase, user } = await session();
  if (!p.success || !user || !(await allow(RULES.rules, user.id))) return;
  await supabase.from("category_rules").delete().eq("id", p.data.id).eq("space_id", p.data.spaceId);
  revalidatePath("/reglas");
}

/** Sube o baja una regla: se renumeran las prioridades de la burbuja de 10 en 10. */
export async function moveRule(fd: FormData) {
  const p = moveSchema.safeParse(fd2obj(fd));
  const { supabase, user } = await session();
  if (!p.success || !user || !(await allow(RULES.rules, user.id))) return;
  const { data } = await supabase.from("category_rules").select("id").eq("space_id", p.data.spaceId).order("priority").order("created_at");
  const ids = (data ?? []).map((r) => r.id);
  const i = ids.indexOf(p.data.id);
  const j = p.data.dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  await Promise.all(ids.map((id, n) => supabase.from("category_rules").update({ priority: (n + 1) * 10 }).eq("id", id).eq("space_id", p.data.spaceId)));
  revalidatePath("/reglas");
}

/** "¿Crear la regla 'Mercadona → Súper'?": se acepta desde el aviso tras corregir dos veces la misma categoría. */
export async function acceptRuleHint(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const x = await getTx();
  const p = acceptSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const { supabase, user } = await session();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.rules, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { data: last } = await supabase.from("category_rules").select("priority").eq("space_id", p.data.spaceId).order("priority", { ascending: false }).limit(1);
  const { error } = await supabase.from("category_rules").insert({ space_id: p.data.spaceId, match_text: p.data.text, match_type: "contains", category_id: p.data.categoryId, priority: (last?.[0]?.priority ?? 0) + 10 });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/reglas");
  return { ok: true };
}
