"use server";

import { getTx } from "@/i18n/tx";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE } from "@/i18n/request";
import { rpcMessage } from "@/server/rpc-error";
import type { FormState } from "./auth";

const ONE_YEAR = 60 * 60 * 24 * 365;
const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: ONE_YEAR };

export async function setLocale(fd: FormData) {
  const locale = fd.get("locale") === "en" ? "en" : "es";
  (await cookies()).set(LOCALE_COOKIE, locale, cookieOpts);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user && !data.user.is_anonymous) await supabase.from("profiles").update({ locale }).eq("id", data.user.id);
  revalidatePath("/", "layout");
}

export async function setTheme(fd: FormData) {
  const v = fd.get("theme");
  const theme = v === "light" || v === "dark" ? v : "system";
  (await cookies()).set("fifti_theme", theme, cookieOpts);
  revalidatePath("/", "layout");
}

export async function toggleDiscreet() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) return;
  const { data: p } = await supabase.from("profiles").select("discreet_mode").eq("id", data.user.id).maybeSingle();
  await supabase.from("profiles").update({ discreet_mode: !p?.discreet_mode }).eq("id", data.user.id);
  revalidatePath("/", "layout");
}

export async function toggleAiPhrases() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) return;
  const { data: p } = await supabase.from("profiles").select("ai_phrases").eq("id", data.user.id).maybeSingle();
  await supabase.from("profiles").update({ ai_phrases: !p?.ai_phrases }).eq("id", data.user.id);
  revalidatePath("/", "layout");
}

/** Borrar la cuenta: pide la contraseña, traspasa/borra grupos, anonimiza el nombre y elimina el usuario. */
export async function deleteAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const password = String(fd.get("password") ?? "");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user || user.is_anonymous || !user.email || password.length < 1 || password.length > 128) return { error: x("No se ha podido completar.") };
  if (!(await allow(RULES.passwordChange, user.id))) return { error: x("Demasiados intentos. Espera un rato.") };

  const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password });
  if (authErr) return { error: x("Contraseña incorrecta.") };
  const { error } = await supabase.rpc("prepare_account_deletion");
  if (error) return { error: x(rpcMessage(error)) };
  const { error: delErr } = await createAdminClient().auth.admin.deleteUser(user.id);
  if (delErr) {
    console.error("[deleteAccount]", delErr.message);
    return { error: x("No se ha podido borrar la cuenta. Inténtalo de nuevo.") };
  }
  await supabase.auth.signOut();
  const jar = await cookies();
  for (const c of ["fifti_bubble", LOCALE_COOKIE, "fifti_theme"]) jar.delete(c);
  redirect("/");
}
