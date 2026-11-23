import type { Cents } from "./types";

/** Convierte "12,50" o "12.5" en céntimos. Devuelve null si no es válido. */
export function parseToCents(input: string): Cents | null {
  const s = input.trim().replace(/\s/g, "");
  if (!/^\d{1,12}([.,]\d{0,2})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Único formateador de dinero de la app. `useGrouping: "always"` evita que el español omita el punto de miles
 * con 4 cifras (2.100,00 € y no 2100,00 €). Con `en-GB`: €2,100.00.
 */
export function formatMoney(cents: Cents, currency = "EUR", locale = "es-ES"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, useGrouping: "always" }).format(cents / 100);
}

/** Solo el número con dos decimales y miles (para CSV y textos): 2.100,00. */
export function formatAmount(cents: Cents, locale = "es-ES"): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }).format(cents / 100);
}

/** Símbolo de la moneda (€, $, £…) según el idioma. */
export function currencySymbol(currency: string, locale = "es-ES"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
}

/** Agrupa por miles el importe que se está tecleando ("2100,5" → "2.100,5"). Solo para mostrar. */
export function groupTyped(typed: string, locale = "es-ES"): string {
  const dec = locale.startsWith("es") ? "," : ".";
  const sep = locale.startsWith("es") ? "." : ",";
  const [whole = "", frac] = typed.split(",");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return frac === undefined ? grouped : `${grouped}${dec}${frac}`;
}
