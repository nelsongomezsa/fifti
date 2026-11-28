"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTx } from "@/i18n/tx-client";
import { currencySymbol, formatMoney, parseToCents } from "@/lib/money";
import { contributeHousehold } from "@/server/actions/space-admin";

type Home = { id: string; name: string; expectedCents: number; paidCents: number; currency: string };

/** Aportar al hogar: elegir hogar e importe (o tu parte del plan) y guardar. Aparece al instante y se confirma por detrás. */
export function ContributeForm({ homes, demo }: { homes: Home[]; demo: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [homeId, setHomeId] = useState(homes[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const [pending, start] = useTransition();
  const home = homes.find((h) => h.id === homeId);
  const cents = parseToCents(amount) ?? 0;
  const remaining = home ? Math.max(0, home.expectedCents - home.paidCents) : 0;
  const currency = home?.currency ?? "EUR";
  const fmt = (c: number) => formatMoney(c, currency, x.locale);

  const save = () => {
    if (cents <= 0 || !home) return;
    if (demo) { setState({ kind: "error", text: x("Crea una cuenta para guardar") }); return; }
    setState({ kind: "saved", text: `${fmt(cents)} ${x("aportados a")} ${home.name}` }); // optimista
    start(async () => {
      const r = await contributeHousehold({ spaceId: home.id, amountCents: cents }).catch(() => ({ ok: false, error: x("No se ha podido completar.") }));
      if (!r.ok) setState({ kind: "error", text: r.error ?? x("No se ha podido completar.") });
      else { setAmount(""); router.refresh(); }
    });
  };

  if (homes.length === 0) return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-4">
      <p className="text-sm text-ink-2">{x("Aún no tienes un hogar.")}</p>
      <Link href="/nueva" className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent">{x("Crear un hogar")}</Link>
    </div>
  );
  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {homes.length > 1 && (
        <label className="flex flex-col gap-1 text-sm text-ink-2">{x("Espacio")}
          <select value={homeId} onChange={(e) => setHomeId(e.target.value)} className="min-h-12 rounded-card border border-border bg-surface px-4 text-base text-ink">{homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </label>
      )}
      <div className="flex items-baseline gap-2 rounded-card border border-border bg-surface px-4 py-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent">
        <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setState({ kind: "idle" }); }} placeholder="0,00" aria-label={x("Importe")} autoFocus className="t-display w-full min-w-0 border-0 bg-transparent p-0 text-ink !outline-none placeholder:text-ink-3" />
        <span className="t-figure text-ink-3">{currencySymbol(currency, x.locale)}</span>
      </div>
      {home && home.expectedCents > 0 && (
        <button type="button" onClick={() => setAmount((remaining / 100).toFixed(2).replace(".", ","))} disabled={remaining === 0} className="min-h-11 self-start rounded-full border border-border px-4 text-sm font-medium disabled:opacity-50">
          {remaining > 0 ? `${x("Lo que falta de tu parte del plan")}: ${fmt(remaining)}` : x("Tu parte del plan ya está aportada")}
        </button>
      )}
      {home && home.paidCents > 0 && <p className="text-sm text-ink-3">{x("Este mes has aportado")} <span className="money font-mono text-ink">{fmt(home.paidCents)}</span></p>}
      {state.kind === "saved" && <p role="status" className="text-sm text-ink-2">{state.text}</p>}
      {state.kind === "error" && <p role="alert" className="text-sm text-over-text">{state.text}</p>}
      <button type="submit" disabled={cents <= 0 || pending} className="min-h-14 rounded-full bg-accent px-6 text-base font-semibold text-on-accent disabled:opacity-50">{pending ? x("Guardando…") : x("Aportar al hogar")}</button>
    </form>
  );
}
