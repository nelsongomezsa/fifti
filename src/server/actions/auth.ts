"use server";

import { getTx } from "@/i18n/tx";

import { redirect } from "next/navigation";
import { publicEnv } from "@/lib/env";
import { hit, hitIp, RULES } from "@/lib/security/rate-limit";
import { pwnedCount } from "@/lib/security/hibp";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, recoverSchema, resetSchema, safeNext, signUpSchema } from "@/lib/validation/auth";

export type FormState = { ok?: boolean; error?: string; message?: string; link?: string };

const TOO_MANY = "Demasiados intentos. Espera un rato e inténtalo de nuevo.";
const GENERIC = "No hemos podido completar la operación. Inténtalo de nuevo.";
const PWNED = "Esa contraseña aparece en filtraciones de datos. Elige otra distinta.";
const MAIL_LIMIT = "Ahora mismo no podemos enviar más correos. Inténtalo de nuevo en una hora.";
const BAD_EMAIL = "Ese email no es válido.";

const field = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

export async function signUp(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = signUpSchema.safeParse({
    displayName: field(fd, "displayName"),
    email: field(fd, "email"),
    password: field(fd, "password"),
  });
  if (!parsed.success) return { error: x(parsed.error.issues[0]?.message ?? GENERIC) };
  const { displayName, email, password } = parsed.data;

  if (!(await hitIp(RULES.signup))) return { error: x(TOO_MANY) };

  const count = await pwnedCount(password);
  if (count !== null && count > 0) return { error: x(PWNED) };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(safeNext(field(fd, "next")))}`,
      },
    });
    if (error) {
      // Solo se distinguen errores que no revelan si una cuenta existe (límite global de correos, formato del email).
      if (error.code === "over_email_send_rate_limit" || error.status === 429) {
        console.error("[signUp] límite de correos de Auth alcanzado");
        return { error: x(MAIL_LIMIT) };
      }
      if (error.code === "email_address_invalid") return { error: x(BAD_EMAIL) };
      if (error.code === "weak_password") return { error: x(PWNED) };
      if (error.code !== "user_already_exists") throw error;
    }
  } catch (err) {
    console.error("[signUp]", err instanceof Error ? `${(err as { code?: string }).code ?? ""} ${err.message}` : "error");
    return { error: x(GENERIC) };
  }
  // Respuesta idéntica exista o no la cuenta: no se revela qué emails están registrados.
  return { ok: true, message: x("Te hemos enviado un email para confirmar tu cuenta. Ábrelo para entrar.") };
}

export async function logIn(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = loginSchema.safeParse({ email: field(fd, "email"), password: field(fd, "password") });
  if (!parsed.success) return { error: x("Email o contraseña incorrectos.") };
  const { email, password } = parsed.data;

  const [ipOk, emailOk] = await Promise.all([hitIp(RULES.login), hit(RULES.loginEmail, `email:${email}`)]);
  if (!ipOk || !emailOk) return { error: x(TOO_MANY) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return { error: x("Confirma tu email antes de entrar. Revisa tu bandeja.") };
    return { error: x("Email o contraseña incorrectos.") };
  }
  redirect(safeNext(field(fd, "next")));
}

export async function requestPasswordReset(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = recoverSchema.safeParse({ email: field(fd, "email") });
  const done: FormState = { ok: true, message: x("Si el email existe, te hemos enviado un enlace para restablecer la contraseña.") };
  if (!parsed.success) return done;
  const { email } = parsed.data;

  const [ipOk, emailOk] = await Promise.all([hitIp(RULES.recover), hit(RULES.recoverEmail, `email:${email}`)]);
  if (!ipOk || !emailOk) return { error: x(TOO_MANY) };

  try {
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=/restablecer`,
    });
  } catch (err) {
    console.error("[recover]", err instanceof Error ? err.message : "error");
  }
  return done;
}

export async function updatePassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = resetSchema.safeParse({ password: field(fd, "password") });
  if (!parsed.success) return { error: x(parsed.error.issues[0]?.message ?? GENERIC) };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: x("El enlace ha caducado. Pide uno nuevo.") };

  if (!(await hit(RULES.passwordChange, `user:${data.user.id}`))) return { error: x(TOO_MANY) };

  const count = await pwnedCount(parsed.data.password);
  if (count !== null && count > 0) return { error: x(PWNED) };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("[updatePassword]", error.message);
    return { error: x(GENERIC) };
  }
  redirect("/inicio");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Un invitado se crea cuenta conservando su historial (la sesión anónima pasa a permanente). */
export async function upgradeGuest(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = signUpSchema.omit({ displayName: true }).safeParse({ email: field(fd, "email"), password: field(fd, "password") });
  if (!parsed.success) return { error: x(parsed.error.issues[0]?.message ?? GENERIC) };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !data.user.is_anonymous) return { error: x(GENERIC) };
  if (!(await hit(RULES.signup, `user:${data.user.id}`)) || !(await hitIp(RULES.signup))) return { error: x(TOO_MANY) };
  const count = await pwnedCount(parsed.data.password);
  if (count !== null && count > 0) return { error: x(PWNED) };
  const { error } = await supabase.auth.updateUser({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    console.error("[upgradeGuest]", error.message);
    return { error: x(GENERIC) };
  }
  return { ok: true, message: x("Te hemos enviado un email para confirmar tu cuenta. Tu historial se conserva.") };
}
