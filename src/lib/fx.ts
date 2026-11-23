/** Monedas ofrecidas en la app (las que publica el BCE a través de Frankfurter). */
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "TRY", "MXN", "BRL"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const isCurrency = (c: string): c is Currency => (CURRENCIES as readonly string[]).includes(c);

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
