"use server";

import { getTx } from "@/i18n/tx";

import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { MAX_AMOUNT_CENTS, parseToCents } from "@/lib/money";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { parsePercentToBp, uuidSchema } from "@/lib/validation/spaces";
import { notify } from "@/server/push";
import { rpcMessage } from "@/server/rpc-error";
import type { FormState } from "./auth";

const f = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v : ""; };
async function ctx() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Fecha no válida");
const cents = z.number().int().min(1, "Pon un importe").max(MAX_AMOUNT_CENTS);

const goalSchema = z
  .object({
    spaceId: z.uuid(), name: z.string().trim().min(1, "Pon un nombre").max(60), targetCents: cents,
    deadline: isoDate.nullable(), emoji: z.string().trim().max(8).nullable(), kind: z.enum(["simple", "big_event", "challenge"]),
  })
  .strict();

export async function createGoal(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const kind = f(fd, "kind") || "simple";
  const parsed = goalSchema.safeParse({
    spaceId: f(fd, "spaceId"), name: f(fd, "name"),
    targetCents: kind === "challenge" ? 137800 : (parseToCents(f(fd, "target")) ?? 0),
    deadline: f(fd, "deadline") || null, emoji: f(fd, "emoji") || null, kind,
  });
  if (!parsed.success) return { error: x(parsed.error.issues[0]?.message ?? "Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const v = parsed.data;
  const { data, error } = await supabase.from("savings_goals").insert({
    space_id: v.spaceId, name: v.name, target_cents: v.targetCents, deadline: v.deadline, emoji: v.emoji, kind: v.kind,
  }).select("id").single();
  if (error || !data) return { error: x("No se ha podido crear la meta.") };
  if (v.kind === "challenge") await supabase.from("saving_rules").insert({ space_id: v.spaceId, goal_id: data.id, kind: "weekly_challenge", value: 100 });
  revalidatePath("/ahorro");
  redirect(`/ahorro/${data.id}`);
}

export async function addContribution(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const goal = uuidSchema.safeParse(f(fd, "goalId"));
  const amount = parseToCents(f(fd, "amount"));
  const source = f(fd, "source") === "challenge" ? "challenge" : "manual";
  if (!goal.success || !amount || amount > MAX_AMOUNT_CENTS) return { error: x("Pon un importe válido") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { error } = await supabase.rpc("add_goal_contribution", { p_goal: goal.data, p_amount: amount, p_source: source, p_date: null });
  if (error) return { error: x(rpcMessage(error)) };
  const { data: g } = await supabase.from("savings_goals").select("name, target_cents, space_id").eq("id", goal.data).maybeSingle();
  const { data: sums } = await supabase.from("goal_contributions").select("amount_cents").eq("goal_id", goal.data);
  const total = (sums ?? []).reduce((a, c) => a + c.amount_cents, 0);
  if (g && total >= g.target_cents && total - amount < g.target_cents) {
    const ms = (await supabase.from("space_members").select("user_id").eq("space_id", g.space_id).not("user_id", "is", null)).data ?? [];
    await notify(ms.map((m) => m.user_id as string), "goal_reached", (t) => ({ title: t("¡Meta alcanzada!"), body: g.name, url: `/ahorro/${goal.data}` }), goal.data);
  }
  revalidatePath(`/ahorro/${goal.data}`);
  return { ok: true, message: x("Aportación guardada.") };
}


export async function addMilestone(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const goal = uuidSchema.safeParse(f(fd, "goalId"));
  const space = uuidSchema.safeParse(f(fd, "spaceId"));
  const amount = parseToCents(f(fd, "amount"));
  const due = f(fd, "dueOn");
  const name = f(fd, "name").trim();
  if (!goal.success || !space.success || !amount || amount > MAX_AMOUNT_CENTS || !name || name.length > 60 || (due && !isoDate.safeParse(due).success)) return { error: x("Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const { error } = await supabase.from("goal_milestones").insert({ goal_id: goal.data, space_id: space.data, name, due_on: due || null, amount_cents: amount });
  if (error) return { error: x("No se ha podido añadir el pago.") };
  revalidatePath(`/ahorro/${goal.data}`);
  return { ok: true, message: x("Pago añadido.") };
}

export async function toggleMilestone(fd: FormData) {
  const id = uuidSchema.safeParse(f(fd, "milestoneId"));
  const goal = uuidSchema.safeParse(f(fd, "goalId"));
  if (!id.success || !goal.success) return;
  const { supabase, user } = await ctx();
  if (!user) return;
  await supabase.from("goal_milestones").update({ paid: f(fd, "paid") === "1" }).eq("id", id.data);
  revalidatePath(`/ahorro/${goal.data}`);
}

export async function saveRule(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const goal = uuidSchema.safeParse(f(fd, "goalId"));
  const space = uuidSchema.safeParse(f(fd, "spaceId"));
  const kind = z.enum(["roundup", "percent_of_income"]).safeParse(f(fd, "kind"));
  if (!goal.success || !space.success || !kind.success) return { error: x("Datos no válidos") };
  const value = kind.data === "percent_of_income" ? parsePercentToBp(f(fd, "value")) : (f(fd, "value") ? parseToCents(f(fd, "value")) : 100);
  if (!value || value <= 0 || (kind.data === "percent_of_income" && value > 10000)) return { error: x("Valor no válido") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  await supabase.from("saving_rules").delete().eq("goal_id", goal.data).eq("kind", kind.data);
  const { error } = await supabase.from("saving_rules").insert({ space_id: space.data, goal_id: goal.data, kind: kind.data, value });
  if (error) return { error: x("No se ha podido guardar la regla.") };
  revalidatePath(`/ahorro/${goal.data}`);
  return { ok: true, message: x("Regla activada.") };
}

const updateGoalSchema = z.object({ goalId: z.uuid(), name: z.string().trim().min(1, "Pon un nombre").max(60), targetCents: cents, deadline: isoDate.nullable() }).strict();

/** Editar nombre, objetivo y fecha límite de una meta. */
export async function updateGoal(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = updateGoalSchema.safeParse({ goalId: f(fd, "goalId"), name: f(fd, "name"), targetCents: parseToCents(f(fd, "target")) ?? 0, deadline: f(fd, "deadline") || null });
  if (!parsed.success) return { error: x(parsed.error.issues[0]?.message ?? "Datos no válidos") };
  const { supabase, user } = await ctx();
  if (!user) return { error: x("Sesión caducada.") };
  const v = parsed.data;
  const { error } = await supabase.from("savings_goals").update({ name: v.name, target_cents: v.targetCents, deadline: v.deadline }).eq("id", v.goalId);
  if (error) return { error: x("No se ha podido guardar.") };
  revalidatePath(`/ahorro/${v.goalId}`);
  revalidatePath("/ahorro");
  return { ok: true, message: x("Meta guardada.") };
}
