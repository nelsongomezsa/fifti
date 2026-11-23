"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { proposeOffset, parseToCents, type PairDebt } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { MAX_AMOUNT_CENTS } from "@/lib/money";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { uuidSchema } from "@/lib/validation/spaces";
import { loadSpaceBalance } from "@/server/balance";
import { rpcMessage } from "@/server/rpc-error";
import type { FormState } from "./auth";

const settleSchema = z
  .object({
    spaceId: z.uuid(), from: z.uuid(), to: z.uuid(), amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
    method: z.enum(["bizum", "transfer", "cash", "other"]), note: z.string().trim().max(120).optional(),
  })
  .strict();

async function ctx() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function recordSettlement(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = settleSchema.safeParse({
    spaceId: fd.get("spaceId"), from: fd.get("from"), to: fd.get("to"), amountCents: parseToCents(String(fd.get("amount") ?? "")) ?? 0,
    method: fd.get("method"), note: String(fd.get("note") ?? "") || undefined,
  });
  if (!parsed.success) return { error: "Datos no válidos" };
  const { supabase, user } = await ctx();
  if (!user) return { error: "Sesión caducada." };
  const v = parsed.data;
  const { error } = await supabase.rpc("record_settlement", {
    p_space: v.spaceId, p_from: v.from, p_to: v.to, p_amount: v.amountCents, p_method: v.method, p_note: v.note ?? null, p_date: null,
  });
  if (error) return { error: rpcMessage(error) };
  revalidatePath("/balance");
  return { ok: true, message: "Pago registrado." };
}

export async function deleteSettlement(fd: FormData) {
  const id = uuidSchema.safeParse(fd.get("settlementId"));
  if (!id.success) return;
  const { supabase, user } = await ctx();
  if (!user) return;
  await supabase.rpc("delete_settlement", { p_id: id.data });
  revalidatePath("/balance");
}

/** Calcula en el servidor las deudas directas entre el usuario y otra persona en los grupos que comparten. */
async function pairDebts(otherUserId: string) {
  const { supabase, user } = await ctx();
  if (!user) throw new Error("auth");
  const { data: mine } = await supabase.from("space_members").select("space_id, id").eq("user_id", user.id);
  const { data: theirs } = await supabase.from("space_members").select("space_id, id").eq("user_id", otherUserId);
  const shared = (mine ?? []).filter((m) => (theirs ?? []).some((t) => t.space_id === m.space_id));
  const { data: spaces } = await supabase.from("spaces").select("id, name, kind").in("id", shared.map((s) => s.space_id)).neq("kind", "personal");
  const memberMap = new Map<string, string>();
  const debts: PairDebt[] = [];
  const names = new Map<string, string>();
  for (const sp of spaces ?? []) {
    names.set(sp.id, sp.name);
    const b = await loadSpaceBalance(supabase, sp.id);
    const uidOf = (mid: string) => b.members.find((m) => m.id === mid)?.user_id ?? null;
    for (const m of b.members) if (m.user_id) memberMap.set(`${sp.id}:${m.user_id}`, m.id);
    for (const t of b.transfers) {
      const f = uidOf(t.from), to = uidOf(t.to);
      if (f && to && ((f === user.id && to === otherUserId) || (f === otherUserId && to === user.id))) debts.push({ spaceId: sp.id, from: f, to, amountCents: t.amountCents });
    }
  }
  return { supabase, user, debts, names, memberOf: (s: string, u: string) => memberMap.get(`${s}:${u}`) };
}

export async function getOfferPreview(otherUserId: string) {
  if (!uuidSchema.safeParse(otherUserId).success) return null;
  const { user, debts, memberOf, names } = await pairDebts(otherUserId);
  const p = proposeOffset(user.id, otherUserId, debts, memberOf);
  return p && { ...p, names: Object.fromEntries(names) };
}

export async function proposeOffsetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const other = uuidSchema.safeParse(fd.get("otherUserId"));
  if (!other.success) return { error: "Datos no válidos" };
  const { supabase, user } = await ctx();
  if (!user) return { error: "Sesión caducada." };
  if (!(await allow(RULES.createLink, user.id))) return { error: "Demasiados intentos. Espera un rato." };
  const { debts, memberOf } = await pairDebts(other.data);
  const p = proposeOffset(user.id, other.data, debts, memberOf);
  if (!p) return { error: "No hay deudas en los dos sentidos que compensar." };
  const { error } = await supabase.rpc("propose_offset", {
    p_other: other.data, p_lines: p.lines.map((l) => ({ space_id: l.spaceId, from_member: l.fromMemberId, to_member: l.toMemberId, amount_cents: l.amountCents })),
  });
  if (error) return { error: rpcMessage(error) };
  revalidatePath("/balance");
  return { ok: true, message: "Propuesta enviada. Se aplicará cuando la otra persona la confirme." };
}

export async function confirmOffset(fd: FormData) {
  const id = uuidSchema.safeParse(fd.get("offsetId"));
  if (!id.success) return;
  const { supabase, user } = await ctx();
  if (!user) return;
  await supabase.rpc("confirm_offset", { p_id: id.data });
  revalidatePath("/balance");
}

export async function rejectOffset(fd: FormData) {
  const id = uuidSchema.safeParse(fd.get("offsetId"));
  if (!id.success) return;
  const { supabase, user } = await ctx();
  if (!user) return;
  await supabase.rpc("reject_offset", { p_id: id.data });
  revalidatePath("/balance");
}
