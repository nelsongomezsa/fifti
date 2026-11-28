/** Monedas ofrecidas en la app (las que publica el BCE a través de Frankfurter). */
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "TRY", "MXN", "BRL"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const isCurrency = (c: string): c is Currency => (CURRENCIES as readonly string[]).includes(c);

/** "AUD · A$ · dólar australiano": código, símbolo y nombre en el idioma de la app. */
export function currencyLabel(code: Currency, locale = "es-ES"): string {
  const symbol = new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
  const name = new Intl.DisplayNames(locale, { type: "currency" }).of(code) ?? code;
  return [code, symbol === code ? null : symbol, name].filter(Boolean).join(" · ");
}

const BY_REGION: Record<string, Currency> = {
  AU: "AUD", US: "USD", GB: "GBP", CH: "CHF", LI: "CHF", JP: "JPY", CA: "CAD", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", TR: "TRY", MX: "MXN", BR: "BRL",
};

/** Moneda que se propone según la región del navegador (cabecera Accept-Language). Si no hay una clara, euros. */
export function currencyForLanguages(header: string | null | undefined): Currency {
  const region = /^\s*[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})\b/i.exec(header ?? "")?.[1]?.toUpperCase();
  return (region && BY_REGION[region]) || "EUR";
}

/** Serie de Frankfurter ({ rates: { "2026-01-02": { AUD: 1.7 } } }); descarta lo que no sea un día con un cambio razonable. */
export function parseFrankfurterSeries(json: unknown, quote: string): { day: string; rate: number }[] {
  const rates = (json as { rates?: unknown } | null)?.rates;
  if (typeof rates !== "object" || rates === null) return [];
  return Object.entries(rates as Record<string, unknown>).flatMap(([day, v]) => {
    const rate = parseFrankfurter({ rates: v }, quote);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && rate ? [{ day, rate }] : [];
  });
}

/**
 * Extrae el tipo de cambio de una respuesta de Frankfurter ({ rates: { EUR: 0.92 } }).
 * Devuelve null si falta, no es un número finito positivo o es absurdo.
 */
export function parseFrankfurter(json: unknown, quote: string): number | null {
  if (typeof json !== "object" || json === null) return null;
  const rates = (json as { rates?: unknown }).rates;
  if (typeof rates !== "object" || rates === null) return null;
  const r = (rates as Record<string, unknown>)[quote];
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0 || r >= 1_000_000) return null;
  return Math.round(r * 1e8) / 1e8;
}

/** Presupuesto restante hoy por persona: (presupuesto/persona/día × personas − gastado hoy) / personas. Puede ser negativo. */
export function dailyBudgetLeft(perPersonPerDay: number, heads: number, spentToday: number): number {
  if (heads <= 0) return 0;
  return Math.round((perPersonPerDay * heads - spentToday) / heads);
}
