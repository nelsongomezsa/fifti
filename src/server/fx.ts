import "server-only";
import { isCurrency, parseFrankfurter } from "@/lib/fx";
import { createAdminClient } from "@/lib/supabase/admin";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tipo de cambio aplicado a un gasto: 1 unidad de `from` = X unidades de la moneda base del espacio.
 * Misma moneda = 1. Se consulta a Frankfurter (BCE, gratis y sin clave) desde el servidor y se guarda en una caché
 * diaria (`fx_rates`). Si la API falla, se usa el último cambio guardado de los últimos 10 días.
 */
export async function resolveFx(base: string, from: string, date: string): Promise<number | null> {
  if (base === from) return 1;
  if (!isCurrency(base) || !isCurrency(from) || !DAY.test(date)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const day = date > today ? today : date;
  const admin = createAdminClient();

  const { data: hit } = await admin.from("fx_rates").select("rate").eq("day", day).eq("base", from).eq("quote", base).maybeSingle();
  if (hit) return Number(hit.rate);

  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${day}?base=${from}&symbols=${base}`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (res.ok) {
      const rate = parseFrankfurter(await res.json(), base);
      if (rate) {
        await admin.from("fx_rates").upsert({ day, base: from, quote: base, rate });
        return rate;
      }
    }
  } catch (err) {
    console.error("[fx]", err instanceof Error ? err.message : "error");
  }
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10);
  const { data: old } = await admin.from("fx_rates").select("rate").eq("base", from).eq("quote", base).gte("day", since).order("day", { ascending: false }).limit(1).maybeSingle();
  return old ? Number(old.rate) : null;
}
