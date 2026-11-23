import "server-only";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Valida en el servidor el token de Cloudflare Turnstile.
 * - Sin clave secreta configurada: en producción se DENIEGA (falla cerrado); en desarrollo se permite para poder trabajar.
 * - Si Cloudflare no responde, se deniega.
 */
export async function verifyTurnstile(token: string | undefined, ip?: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetcher(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch (err) {
    console.error("[turnstile]", err instanceof Error ? err.message : "error");
    return false;
  }
}
