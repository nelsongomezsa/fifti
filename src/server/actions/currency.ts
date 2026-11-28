"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { CURRENCIES } from "@/lib/fx";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ensureRates, type RateNeed } from "@/server/fx";
import { rpcMessage } from "@/server/rpc-error";
import { VIEW_COOKIE } from "@/server/view-currency";

export type CurrencyResult = { ok: boolean; error?: string };

const changeSchema = z.object({ spaceId: z.uuid(), currency: z.enum(CURRENCIES) }).strict();
const viewSchema = z.object({ currency: z.enum(CURRENCIES).nullable() }).strict();

async function session() {
  const x = await getTx();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { x, supabase, user: data.user };
}

/** Cambia la moneda en la que se suma un espacio. Primero reúne todos los cambios necesarios; si falta alguno, no toca nada. */
export async function changeSpaceCurrency(input: unknown): Promise<CurrencyResult> {
  const p = changeSchema.safeParse(input);
  const { x, supabase, user } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  if (user.app_metadata?.demo === true) return { ok: false, error: x("Crea una cuenta para guardar") };
  if (user.is_anonymous) return { ok: false, error: x("No autorizado.") };
  if (!(await allow(RULES.currency, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
  const { spaceId, currency } = p.data;
  // La propiedad se comprueba antes de usar permisos de servidor (la función de la base la vuelve a comprobar)
  const [{ data: space }, { data: me }] = await Promise.all([
    supabase.from("spaces").select("base_currency").eq("id", spaceId).maybeSingle(),
    supabase.from("space_members").select("role").eq("space_id", spaceId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (!space || me?.role !== "owner") return { ok: false, error: x("No autorizado.") };
  if (space.base_currency === currency) return { ok: true };

  // La lista de cambios necesarios incluye monedas de otras personas: solo la lee el servidor y no se devuelve
  const needs: RateNeed[] = [];
  const admin = createAdminClient();
  for (let from = 0; ; from += 1000) {
    const page = await admin.rpc("currency_change_needs", { p_space: spaceId, p_currency: currency }).range(from, from + 999);
    if (page.error) return { ok: false, error: x("No se ha podido completar.") };
    const rows = (page.data ?? []) as { from_currency: string; to_currency: string; day: string }[];
    needs.push(...rows.map((r) => ({ from: r.from_currency, to: r.to_currency, day: r.day })));
    if (rows.length < 1000) break;
  }
  if (!(await ensureRates(needs))) return { ok: false, error: x("No hemos podido obtener todos los tipos de cambio. No se ha cambiado nada.") };
  const { error } = await supabase.rpc("change_space_currency", { p_space_id: spaceId, p_currency: currency });
  if (error) return { ok: false, error: x(rpcMessage(error)) };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Moneda en la que se quieren VER los totales: solo se recuerda la elección, no convierte ningún dato. */
export async function setViewCurrency(input: unknown): Promise<CurrencyResult> {
  const p = viewSchema.safeParse(input);
  const { x, supabase, user } = await session();
  if (!p.success) return { ok: false, error: x("Datos no válidos") };
  if (!user) return { ok: false, error: x("Sesión caducada.") };
  // Invitados y demo no tienen perfil: la elección se queda en una cookie
  if (user.is_anonymous || user.app_metadata?.demo === true) {
    const jar = await cookies();
    if (p.data.currency) jar.set(VIEW_COOKIE, p.data.currency, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    else jar.delete(VIEW_COOKIE);
  } else {
    if (!(await allow(RULES.planWrites, user.id))) return { ok: false, error: x("Demasiados intentos. Espera un rato.") };
    const { error } = await supabase.from("profiles").update({ view_currency: p.data.currency }).eq("id", user.id);
    if (error) return { ok: false, error: x("No se ha podido guardar.") };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
