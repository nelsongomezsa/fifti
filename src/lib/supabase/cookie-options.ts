import type { CookieOptions } from "@supabase/ssr";

/** La sesión vive solo en cookies httpOnly: el JavaScript del navegador no puede leerla. */
export function hardenCookie(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}
