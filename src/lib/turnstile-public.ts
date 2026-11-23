/** Clave pública (site key) de Cloudflare Turnstile. La clave secreta vive solo en el servidor. */
export const turnstileSiteKey: string = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
