"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTx } from "@/i18n/tx-client";
import { CURRENCIES, currencyLabel } from "@/lib/fx";
import { setViewCurrency } from "@/server/actions/currency";

export function ViewCurrencySelect({ base, value }: { base: string; value: string | null }) {
  const x = useTx();
  const router = useRouter();
  const [chosen, setChosen] = useState(value ?? "");
  const [pending, start] = useTransition();
  return (
    <select aria-label={x("Ver totales en otra moneda")} value={chosen === base ? "" : chosen} disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        setChosen(next);
        start(async () => { await setViewCurrency({ currency: next || null }).catch(() => null); router.refresh(); });
      }}
      className="min-h-11 max-w-full rounded-full border border-border bg-surface px-3 text-sm text-ink-2">
      <option value="">{x("Ver en otra moneda…")}</option>
      {CURRENCIES.filter((c) => c !== base).map((c) => <option key={c} value={c}>{x("Ver en")} {currencyLabel(c, x.locale)}</option>)}
    </select>
  );
}
