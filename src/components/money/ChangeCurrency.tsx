"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CurrencySelect } from "@/components/money/CurrencySelect";
import { CTX_CACHE_KEY } from "@/components/nav/PlusButton";
import { useTx } from "@/i18n/tx-client";
import { changeSpaceCurrency } from "@/server/actions/currency";

/** Moneda de un espacio: elegir, leer qué va a pasar y confirmar. */
export function ChangeCurrency({ spaceId, current, canChange, demo = false }: { spaceId: string; current: string; canChange: boolean; demo?: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = value !== current;

  const confirm = () => {
    setMsg(null);
    if (demo) { setMsg({ ok: false, text: x("Crea una cuenta para guardar") }); return; }
    start(async () => {
      const r = await changeSpaceCurrency({ spaceId, currency: value }).catch(() => ({ ok: false, error: x("No se ha podido completar.") }));
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? x("No se ha podido completar.") }); return; }
      try { localStorage.removeItem(CTX_CACHE_KEY); } catch { /* sin almacenamiento */ }
      setMsg({ ok: true, text: x("Moneda cambiada.") });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
      <label className="flex flex-col gap-1 text-sm text-ink-2">{x("Moneda del espacio")}
        <CurrencySelect value={value} disabled={!canChange || pending} onChange={(e) => { setValue(e.target.value); setMsg(null); }} />
      </label>
      {!canChange && <p className="text-xs text-ink-3">{x("Solo la puede cambiar la persona propietaria del espacio.")}</p>}
      {changed && (
        <div role="alertdialog" aria-label={x("¿Cambiar la moneda?")} className="flex flex-col gap-2 text-sm text-ink-2">
          <p className="font-semibold text-ink">{x("Antes de cambiar, esto es lo que va a pasar:")}</p>
          <ul className="list-disc pl-5">
            <li>{x("Los gastos no se pierden ni cambian su importe original. Se suman y se ven en la moneda nueva, con el cambio del día de cada gasto.")}</li>
            <li>{x("Los ingresos también se convierten con el cambio de su día.")}</li>
            <li>{x("El plan, los gastos fijos, las metas y los favoritos se convierten con el cambio de hoy. Los porcentajes se mantienen.")}</li>
            <li>{x("Las cuentas y los préstamos conservan su propia moneda: sus saldos no cambian.")}</li>
            <li>{x("En espacios compartidos, si ya habíais saldado cuentas puede quedar una pequeña diferencia por el cambio de cada día.")}</li>
            <li>{x("Los importes se redondean: volver atrás puede variar algún céntimo en el plan y las metas.")}</li>
          </ul>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => setValue(current)} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
            <button type="button" disabled={pending} onClick={confirm} className="min-h-12 flex-1 rounded-full bg-accent font-semibold text-on-accent disabled:opacity-60">{pending ? x("Cambiando…") : `${x("Cambiar a")} ${value}`}</button>
          </div>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ink-2" : "text-over-text"}`}>{msg.text}</p>}
    </div>
  );
}
