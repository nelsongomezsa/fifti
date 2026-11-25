import "server-only";
import { turnstileSiteKey } from "@/lib/turnstile-public";

/**
 * Token de Cloudflare Turnstile que el formulario deja en `cf-turnstile-response`. Se pasa tal cual a Supabase Auth
 * (`options.captchaToken`): es Supabase quien lo valida contra Cloudflare, una sola vez (el token es de un solo uso,
 * así que la app NO lo vuelve a validar por su cuenta). Con la protección activada en Supabase, quien llame a Auth
 * directamente con la clave pública sin un token válido es rechazado.
 * Si hay clave de sitio configurada y falta el token, la acción se rechaza antes de llamar a Auth.
 */
export function captchaFrom(fd: FormData): { token: string | undefined; missing: boolean } {
  const raw = fd.get("cf-turnstile-response");
  const token = typeof raw === "string" && raw.length > 0 && raw.length <= 2048 ? raw : undefined;
  return { token, missing: turnstileSiteKey !== "" && !token };
}

export const CAPTCHA_ERROR = "No hemos podido verificar que eres una persona. Inténtalo de nuevo.";
