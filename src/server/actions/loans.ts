"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { MAX_AMOUNT_CENTS, parseToCents } from "@/lib/money";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { rpcMessage } from "@/server/rpc-error";
import type { FormState } from "./auth";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createSchema = z.object({
  direction: z.enum(["lent", "borrowed"]),
  personName: z.string().trim().min(1).max(40),
  linkedUserId: z.uuid().nullable(),
  shared: z.boolean(),
  amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
  loanDate: iso,
  remindOn: iso.nullable(),
  note: z.string().trim().max(80).nullable(),
}).strict().refine((v) => !v.shared || v.linkedUserId !== null, { message: "Para compartirlo, elige a la persona de tus burbujas." });
const repaySchema = z.object({ loanId: z.uuid(), amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS) }).strict();
const idSchema = z.object({ loanId: z.uuid() }).strict();

const f = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function createLoan(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const p = createSchema.safeParse({
    direction: f(fd, "direction"), personName: f(fd, "personName"), linkedUserId: f(fd, "linkedUserId") || null, shared: f(fd, "shared") === "1",
    amountCents: parseToCents(f(fd, "amount")) ?? 0, loanDate: f(fd, "loanDate") || new Date().toISOString().slice(0, 10), remindOn: f(fd, "remindOn") || null, note: f(fd, "note") || null,
  });
  if (!p.success) return { error: x(p.error.issues[0]?.message ?? "Datos no válidos") };
  const { supabase, user } = await session();
  if (!user || user.is_anonymous) return { error: x("Necesitas una cuenta.") };
  if (!(await allow(RULES.loans, user.id))) return { error: x("Demasiados intentos. Espera un rato.") };
  const v = p.data;
  const { error } = await supabase.from("loans").insert({
    direction: v.direction, person_name: v.personName, linked_user_id: v.linkedUserId, shared: v.shared, amount_cents: v.amountCents, loan_date: v.loanDate, remind_on: v.remindOn, note: v.note,
  });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  return { message: x("Préstamo apuntado.") };
}

export async function repayLoan(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const p = repaySchema.safeParse({ loanId: f(fd, "loanId"), amountCents: parseToCents(f(fd, "amount")) ?? 0 });
  if (!p.success) return { error: x("Pon un importe.") };
  const { supabase, user } = await session();
  if (!user) return { error: x("Sesión caducada.") };
  if (!(await allow(RULES.loans, user.id))) return { error: x("Demasiados intentos. Espera un rato.") };
  const { error } = await supabase.from("loan_repayments").insert({ loan_id: p.data.loanId, amount_cents: p.data.amountCents });
  if (error) return { error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  return { message: x("Devolución apuntada.") };
}

/** «Pagado»: apunta de una vez lo que queda. El importe lo calcula el servidor, no llega de la pantalla. */
export async function settleLoan(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const x = await getTx();
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  const { supabase, user } = await session();
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (!(await allow(RULES.loans, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const [{ data: loan }, { data: reps }] = await Promise.all([
    supabase.from("loans").select("amount_cents").eq("id", p.data.loanId).eq("user_id", user.id).maybeSingle(),
    supabase.from("loan_repayments").select("amount_cents").eq("loan_id", p.data.loanId),
  ]);
  if (!loan) return { ok: false, error: x("No se ha podido completar.") };
  const left = loan.amount_cents - (reps ?? []).reduce((a, r) => a + r.amount_cents, 0);
  if (left <= 0) return { ok: true };
  const { error } = await supabase.from("loan_repayments").insert({ loan_id: p.data.loanId, amount_cents: left });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  return { ok: true };
}
