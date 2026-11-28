"use client";

import { useTx } from "@/i18n/tx-client";
import { CURRENCIES, currencyLabel } from "@/lib/fx";

/** Desplegable con las monedas admitidas: código, símbolo y nombre en el idioma de la app. */
export function CurrencySelect({ className, ...props }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children">) {
  const x = useTx();
  return (
    <select {...props} className={className ?? "min-h-12 w-full rounded-card border border-border bg-surface px-4 text-base text-ink"}>
      {CURRENCIES.map((c) => <option key={c} value={c}>{currencyLabel(c, x.locale)}</option>)}
    </select>
  );
}
