"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTx } from "@/i18n/tx-client";
import { setFundAccount } from "@/server/actions/accounts";

/** Cuenta asociada a una partida (se usa para repartir la nómina entre cuentas). */
export function FundAccountPicker({ fundId, accounts, current, demo }: { fundId: string; accounts: { id: string; name: string }[]; current: string | null; demo: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();
  if (accounts.length === 0) return null;
  const change = (v: string) => {
    setErr(null);
    if (demo) return setErr(x("Crea una cuenta para guardar"));
    const prev = value; setValue(v); // optimista
    start(async () => {
      const r = await setFundAccount({ fundId, accountId: v || null }).catch(() => null);
      if (!r?.ok) { setValue(prev); setErr(r?.error ?? x("No se ha podido completar.")); } else router.refresh();
    });
  };
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <label className="flex items-center justify-between gap-3 text-sm">{x("Cuenta de esta partida")}
        <select value={value} onChange={(e) => change(e.target.value)} className="min-h-11 max-w-[55%] rounded-card border border-border bg-surface-2 px-3 text-ink">
          <option value="">{x("Sin cuenta")}</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <p className="mt-1 text-xs text-ink-3">{x("Al cobrar la nómina, Fifti te sugiere pasar a esta cuenta lo previsto para la partida.")}</p>
      {err && <p role="alert" className="mt-1 text-sm text-over-text">{err}</p>}
    </div>
  );
}
