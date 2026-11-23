"use server";

import { redirect } from "next/navigation";
import { publicEnv } from "@/lib/env";
import { hit, hitIp, RULES } from "@/lib/security/rate-limit";
import { pwnedCount } from "@/lib/security/hibp";
import { createClient } from "@/lib/supabase/server";
import { loginSchema, recoverSchema, resetSchema, signUpSchema } from "@/lib/validation/auth";

export type FormState = { ok?: boolean; error?: string; message?: string };

const TOO_MANY = "Demasiados intentos. Espera un rato e inténtalo de nuevo.";
const GENERIC = "No hemos podido completar la operación. Inténtalo de nuevo.";
const PWNED = "Esa contraseña aparece en filtraciones de datos. Elige otra distinta.";

const field = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

export async function signUp(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    displayName: field(fd, "displayName"),
    email: field(fd, "email"),
    password: field(fd, "password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC };
  const { displayName, email, password } = parsed.data;

  if (!(await hitIp(RULES.signup))) return { error: TOO_MANY };

  const count = await pwnedCount(password);
  if (count !== null && count > 0) return { error: PWNED };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${publicEnv().NEXT_PUBLIC_SITE_URL}/auth/callback?next=/inicio`,
      },
    });
    if (error && error.status !== 422 && error.status !== 400) throw error;
  } catch (err) {
    console.error("[signUp]", err instanceof Error ? err.message : "error");
    return { error: GENERIC };
  }
  // Respuesta idéntica exista o no la cuenta: no se revela qué emails están registrados.
  return { ok: true, message: "Te hemos enviado un email para confirmar tu cuenta. Ábrelo para entrar." };
}

export async function logIn(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: field(fd, "email"), password: field(fd, "password") });
  if (!parsed.success) return { error: "Email o contraseña incorrectos." };
  const { email, password } = parsed.data;

  const [ipOk, emailOk] = await Promise.all([hitIp(RULES.login), hit(RULES.loginEmail, `email:${email}`)]);
  if (!ipOk || !emailOk) return { error: TOO_MANY };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Confirma tu email antes de entrar. Revisa tu bandeja." };
    return { error: "Email o contraseña incorrectos." };
  }
  redirect("/inicio");
}

export async function requestPasswordReset(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = recoverSchema.safeParse({ email: field(fd, "email") });
  const done: FormState = { ok: true, message: "Si el email existe, te hemos enviado un enlace para restablecer la contraseña." };
  if (!parsed.success) return done;
  const { email } = parsed.data;

  const [ipOk, emailOk] = await Promise.all([hitIp(RULES.recover), hit(RULES.recoverEmail, `email:${email}`)]);
  if (!ipOk || !emailOk) return { error: TOO_MANY };

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
  const parsed = resetSchema.safeParse({ password: field(fd, "password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "El enlace ha caducado. Pide uno nuevo." };

  if (!(await hit(RULES.passwordChange, `user:${data.user.id}`))) return { error: TOO_MANY };

  const count = await pwnedCount(parsed.data.password);
  if (count !== null && count > 0) return { error: PWNED };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("[updatePassword]", error.message);
    return { error: GENERIC };
  }
  redirect("/inicio");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
