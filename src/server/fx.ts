import "server-only";
import { isCurrency, parseFrankfurter, parseFrankfurterSeries } from "@/lib/fx";
import { DEMO_RATES } from "@/lib/demo/rates";
import { isDemoRequest } from "@/lib/demo/mode";
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
  // La demo no usa red ni base de datos: cambios inventados y fijos
  if (await isDemoRequest()) return (DEMO_RATES[from] ?? 1) / (DEMO_RATES[base] ?? 1);
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

const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export type RateNeed = { from: string; to: string; day: string };

/**
 * Deja en la caché los cambios de todas estas fechas (una petición por par y tramo de 90 días; a la API solo viajan monedas y fechas).
 * Una fecha está cubierta si hay cambio ese día o en los 10 anteriores, igual que en la base de datos. false si falta alguna.
 */
export async function ensureRates(needs: RateNeed[]): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const pairs = new Map<string, Set<string>>();
  for (const n of needs) {
    if (n.from === n.to) continue;
    if (!isCurrency(n.from) || !isCurrency(n.to) || !DAY.test(n.day)) return false;
    const key = `${n.from}|${n.to}`;
    (pairs.get(key) ?? pairs.set(key, new Set()).get(key)!).add(n.day > today ? today : n.day);
  }
  const admin = createAdminClient();
  let requests = 0;
  for (const [key, set] of pairs) {
    const [from, to] = key.split("|") as [string, string];
    const days = [...set].sort();
    const missing = async () => {
      const { data } = await admin.from("fx_rates").select("day").eq("base", from).eq("quote", to).gte("day", shift(days[0]!, -10)).lte("day", days[days.length - 1]!).limit(5000);
      const have = (data ?? []).map((r) => r.day as string);
      return days.filter((d) => !have.some((h) => h <= d && h >= shift(d, -10)));
    };
    let pending = await missing();
    while (pending.length > 0) {
      if (++requests > 60) return false;
      const start = shift(pending[0]!, -7);
      const limit = shift(pending[0]!, 83);
      const chunk = pending.filter((d) => d <= limit);
      try {
        const res = await fetch(`https://api.frankfurter.dev/v1/${start}..${chunk[chunk.length - 1]}?base=${from}&symbols=${to}`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
        if (!res.ok) return false;
        const rows = parseFrankfurterSeries(await res.json(), to).map((r) => ({ day: r.day, base: from, quote: to, rate: r.rate }));
        if (rows.length > 0 && (await admin.from("fx_rates").upsert(rows)).error) return false;
      } catch (err) {
        console.error("[fx]", err instanceof Error ? err.message : "error");
        return false;
      }
      pending = pending.slice(chunk.length);
    }
    if ((await missing()).length > 0) return false;
  }
  return true;
}

/** Adelanta a la caché cambios que la base de datos puede necesitar al guardar. Si falla, la base usa el más cercano que tenga. */
export async function warmRates(needs: RateNeed[]): Promise<void> {
  const unique = new Map(needs.filter((n) => n.from !== n.to).map((n) => [`${n.from}|${n.to}|${n.day}`, n]));
  await Promise.all([...unique.values()].slice(0, 20).map((n) => resolveFx(n.to, n.from, n.day).catch(() => null)));
}

export type Converted = { total: number; approximate: boolean; missing: boolean };

/** Suma importes de distintas monedas en `target` con el cambio de hoy (solo para mostrar). */
export async function sumIn(target: string, items: { cents: number; currency: string }[]): Promise<Converted> {
  const rates = await ratesTo(target, items.map((i) => i.currency));
  let total = 0, approximate = false, missing = false;
  for (const i of items) {
    const rate = rates.get(i.currency);
    if (rate === undefined) { missing = true; continue; }
    if (i.currency !== target) approximate = true;
    total += Math.round(i.cents * rate);
  }
  return { total, approximate, missing };
}

/** Cambio de hoy desde cada moneda hacia `target`; las que no se puedan obtener no aparecen. */
export async function ratesTo(target: string, currencies: string[]): Promise<Map<string, number>> {
  const today = new Date().toISOString().slice(0, 10);
  const out = new Map<string, number>();
  await Promise.all([...new Set(currencies)].map(async (c) => {
    const rate = c === target ? 1 : await resolveFx(target, c, today);
    if (rate !== null) out.set(c, rate);
  }));
  return out;
}
