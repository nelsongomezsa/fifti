"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { parseToCents } from "@/lib/money";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { generateToken } from "@/lib/security/tokens";
import { createClient } from "@/lib/supabase/server";
import {
  addMemberSchema, createSpaceSchema, linkSchema, parsePercentToBp, sharesSchema, uuidSchema,
} from "@/lib/validation/spaces";
import { rpcMessage } from "@/server/rpc-error";
import type { FormState } from "./auth";

const fv = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v !== "" ? v : undefined;
};

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function createSpace(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = createSpaceSchema.safeParse({
    name: fv(fd, "name") ?? "",
    kind: fv(fd, "kind"),
    currency: fv(fd, "currency") ?? "EUR",
    emoji: fv(fd, "emoji"),
    template: fv(fd, "template"),
    startsOn: fv(fd, "startsOn"),
    endsOn: fv(fd, "endsOn"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos no válidos" };
  const { supabase, user } = await session();
  if (!user || user.is_anonymous) return { error: "Necesitas una cuenta." };
  if (!(await allow(RULES.createLink, user.id))) return { error: "Demasiados intentos. Espera un rato." };

  const v = parsed.data;
  const { data, error } = await supabase.rpc("create_space", {
    p_name: v.name, p_kind: v.kind, p_currency: v.currency, p_emoji: v.emoji ?? null,
    p_template: v.template ?? null, p_starts: v.startsOn ?? null, p_ends: v.endsOn ?? null,
  });
  if (error) return { error: rpcMessage(error) };
  revalidatePath("/", "layout");
  redirect(`/espacio/${data as string}`);
}

export async function addVirtualMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = addMemberSchema.safeParse({ spaceId: fv(fd, "spaceId"), name: fv(fd, "name") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos no válidos" };
  const { supabase, user } = await session();
  if (!user) return { error: "Sesión caducada." };
  const { error } = await supabase.rpc("add_virtual_member", { p_space: parsed.data.spaceId, p_name: parsed.data.name });
  if (error) return { error: rpcMessage(error) };
  revalidatePath(`/espacio/${parsed.data.spaceId}`);
  return { ok: true, message: "Miembro añadido." };
}

export async function saveShares(_prev: FormState, fd: FormData): Promise<FormState> {
  const spaceId = uuidSchema.safeParse(fv(fd, "spaceId"));
  if (!spaceId.success) return { error: "Datos no válidos" };
  const entries: { member_id: string; bp: number }[] = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("bp_") || typeof value !== "string") continue;
    const bp = parsePercentToBp(value);
    if (bp === null) return { error: "Porcentaje no válido" };
    entries.push({ member_id: key.slice(3), bp });
  }
  const parsed = sharesSchema.safeParse(entries);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos no válidos" };
  const { supabase, user } = await session();
  if (!user) return { error: "Sesión caducada." };
  const { error } = await supabase.rpc("set_default_shares", { p_space: spaceId.data, p_shares: parsed.data });
  if (error) return { error: rpcMessage(error) };
  revalidatePath(`/espacio/${spaceId.data}`);
  return { ok: true, message: "Porcentajes guardados." };
}

export async function createLink(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = linkSchema.safeParse({
    spaceId: fv(fd, "spaceId"), kind: fv(fd, "kind"), days: fv(fd, "days") ?? "7", maxUses: fv(fd, "maxUses") ?? "10",
  });
  if (!parsed.success) return { error: "Datos no válidos" };
  const { supabase, user } = await session();
  if (!user) return { error: "Sesión caducada." };
  if (!(await allow(RULES.createLink, user.id))) return { error: "Demasiados enlaces creados. Espera un rato." };

  const { token, hash } = generateToken();
  const v = parsed.data;
  const { error } = await supabase.rpc("create_share_link", {
    p_space: v.spaceId, p_kind: v.kind, p_token_hash: hash, p_ttl_seconds: v.days * 86400, p_max_uses: v.maxUses,
  });
  if (error) return { error: rpcMessage(error) };
  revalidatePath(`/espacio/${v.spaceId}`);
  const path = v.kind === "public_summary" ? "resumen" : "unirse";
  return { ok: true, link: `${publicEnv().NEXT_PUBLIC_SITE_URL}/${path}/${token}` };
}

export async function revokeLink(fd: FormData) {
  const id = uuidSchema.safeParse(fv(fd, "linkId"));
  const spaceId = uuidSchema.safeParse(fv(fd, "spaceId"));
  if (!id.success || !spaceId.success) return;
  const { supabase, user } = await session();
  if (!user) return;
  await supabase.rpc("revoke_share_link", { p_link: id.data });
  revalidatePath(`/espacio/${spaceId.data}`);
}

export async function kickMember(fd: FormData) {
  const id = uuidSchema.safeParse(fv(fd, "memberId"));
  const spaceId = uuidSchema.safeParse(fv(fd, "spaceId"));
  if (!id.success || !spaceId.success) return;
  const { supabase, user } = await session();
  if (!user) return;
  await supabase.rpc("kick_member", { p_member: id.data });
  revalidatePath(`/espacio/${spaceId.data}`);
}

export async function createClaimLink(_prev: FormState, fd: FormData): Promise<FormState> {
  const id = uuidSchema.safeParse(fv(fd, "memberId"));
  if (!id.success) return { error: "Datos no válidos" };
  const { supabase, user } = await session();
  if (!user) return { error: "Sesión caducada." };
  if (!(await allow(RULES.createLink, user.id))) return { error: "Demasiados intentos. Espera un rato." };
  const { token, hash } = generateToken();
  const { error } = await supabase.rpc("create_claim_link", { p_member: id.data, p_token_hash: hash, p_ttl_seconds: 7 * 86400 });
  if (error) return { error: rpcMessage(error) };
  return { ok: true, link: `${publicEnv().NEXT_PUBLIC_SITE_URL}/reclamar/${token}` };
}

const budgetSchema = z.object({ spaceId: z.uuid(), cents: z.number().int().min(1).max(10_000_000).nullable() }).strict();

/** Presupuesto por persona y día (opcional, para viajes). Solo el owner (RLS). */
export async function setDailyBudget(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = fv(fd, "budget");
  const cents = raw ? parseToCents(raw) : null;
  const parsed = budgetSchema.safeParse({ spaceId: fv(fd, "spaceId"), cents });
  if (!parsed.success || (raw && !cents)) return { error: "Importe no válido" };
  const { supabase, user } = await session();
  if (!user) return { error: "Sesión caducada." };
  const { data, error } = await supabase.from("spaces").update({ daily_budget_cents: parsed.data.cents }).eq("id", parsed.data.spaceId).select("id");
  if (error || !data?.length) return { error: "No autorizado." };
  revalidatePath("/", "layout");
  return { ok: true, message: cents ? "Presupuesto guardado." : "Presupuesto quitado." };
}

/** Cierra el plan: crea el enlace de resumen público (30 días) y archiva el grupo. */
export async function closeGroup(_prev: FormState, fd: FormData): Promise<FormState> {
  const spaceId = uuidSchema.safeParse(fv(fd, "spaceId"));
  if (!spaceId.success) return { error: "Datos no válidos" };
  const { supabase, user } = await session();
  if (!user) return { error: "Sesión caducada." };
  if (!(await allow(RULES.createLink, user.id))) return { error: "Demasiados intentos. Espera un rato." };
  const { data: space } = await supabase.from("spaces").select("kind, archived_at").eq("id", spaceId.data).maybeSingle();
  if (!space || space.kind !== "group") return { error: "Solo se cierran los planes espontáneos." };
  if (space.archived_at) return { error: "Este plan ya está cerrado." };

  const { token, hash } = generateToken();
  const { error: linkErr } = await supabase.rpc("create_share_link", { p_space: spaceId.data, p_kind: "public_summary", p_token_hash: hash, p_ttl_seconds: 30 * 86400, p_max_uses: 1000 });
  if (linkErr) return { error: rpcMessage(linkErr) };
  const { data, error } = await supabase.from("spaces").update({ archived_at: new Date().toISOString() }).eq("id", spaceId.data).select("id");
  if (error || !data?.length) return { error: "No autorizado." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Plan cerrado y archivado.", link: `${publicEnv().NEXT_PUBLIC_SITE_URL}/resumen/${token}` };
}

export async function reopenGroup(fd: FormData) {
  const spaceId = uuidSchema.safeParse(fv(fd, "spaceId"));
  if (!spaceId.success) return;
  const { supabase, user } = await session();
  if (!user) return;
  await supabase.from("spaces").update({ archived_at: null }).eq("id", spaceId.data);
  revalidatePath("/", "layout");
}
