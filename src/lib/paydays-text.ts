import type { Tx } from "@/i18n/tx";
import { formatMoney } from "@/lib/money";

/** «Este mes cobras 5 veces: 3.250 AUD», igual en Inicio y en Plan. */
export function paydaysText(x: Tx, p: { count: number; cents: number; currency: string; approximate: boolean }): string {
  const total = `${p.approximate ? "≈ " : ""}${formatMoney(p.cents, p.currency, x.locale)}`;
  return (p.count === 1 ? x("Este mes cobras 1 vez: {total}") : x("Este mes cobras {n} veces: {total}").replace("{n}", String(p.count))).replace("{total}", total);
}
