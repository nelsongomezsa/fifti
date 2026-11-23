import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Mínimo 12 caracteres (NIST), máximo 128 para evitar abuso de hashing. */
export const passwordSchema = z
  .string()
  .min(12, "Usa al menos 12 caracteres")
  .max(128, "Máximo 128 caracteres");

export const MISMATCH = "Las contraseñas no coinciden";
const matches = (v: { password: string; confirmPassword: string }) => v.password === v.confirmPassword;

export const signUpSchema = z
  .object({
    displayName: z.string().trim().min(1, "Pon tu nombre").max(40),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().max(128),
  })
  .strict()
  .refine(matches, { message: MISMATCH, path: ["confirmPassword"] });

/** Un invitado que se crea cuenta: email + contraseña repetida. */
export const upgradeGuestSchema = z
  .object({ email: emailSchema, password: passwordSchema, confirmPassword: z.string().max(128) })
  .strict()
  .refine(matches, { message: MISMATCH, path: ["confirmPassword"] });

export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();

export const recoverSchema = z.object({ email: emailSchema }).strict();

export const resetSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string().max(128) })
  .strict()
  .refine(matches, { message: MISMATCH, path: ["confirmPassword"] });

/** Cambiar la contraseña desde Ajustes: pide la actual, la nueva y su repetición. */
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Escribe tu contraseña actual").max(128), password: passwordSchema, confirmPassword: z.string().max(128) })
  .strict()
  .refine(matches, { message: MISMATCH, path: ["confirmPassword"] });

/** Requisitos de la contraseña nueva, para mostrarlos en directo y activar el botón. Misma regla que el servidor. */
export function passwordRequirements(password: string, confirm: string) {
  const minLength = password.length >= 12 && password.length <= 128;
  const match = confirm.length > 0 && password === confirm;
  return { minLength, match, all: minLength && match };
}

/** Solo rutas internas: evita redirecciones abiertas (//evil.com, https://...). */
export function safeNext(value: string | null | undefined, fallback = "/inicio"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
