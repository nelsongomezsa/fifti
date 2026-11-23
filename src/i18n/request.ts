import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "fifti_locale";

/** Idioma por cookie (sin prefijos en la URL). Por defecto, español. */
export default getRequestConfig(async () => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = value === "en" ? "en" : "es";
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
