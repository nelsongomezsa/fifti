import type { Cents } from "./types";

/** Convierte "12,50" o "12.5" en céntimos. Devuelve null si no es válido. */
export function parseToCents(input: string): Cents | null {
  const s = input.trim().replace(/\s/g, "");
  if (!/^\d{1,12}([.,]\d{0,2})?$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatMoney(cents: Cents, currency = "EUR", locale = "es-ES"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
