import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Mínimo 12 caracteres (NIST), máximo 128 para evitar abuso de hashing. */
export const passwordSchema = z
  .string()
  .min(12, "Usa al menos 12 caracteres")
  .max(128, "Máximo 128 caracteres");

export const signUpSchema = z
  .object({
    displayName: z.string().trim().min(1, "Pon tu nombre").max(40),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();

export const recoverSchema = z.object({ email: emailSchema }).strict();

export const resetSchema = z.object({ password: passwordSchema }).strict();

/** Solo rutas internas: evita redirecciones abiertas (//evil.com, https://...). */
export function safeNext(value: string | null | undefined, fallback = "/inicio"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
