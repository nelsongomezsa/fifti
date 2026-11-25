"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTx } from "@/i18n/tx-client";
import { clearSpace } from "@/server/actions/space-admin";

const DELAY = 10;

/** «Vaciar este espacio»: se escribe el nombre, se puede deshacer durante 10 s y solo entonces se borra de verdad. */
export function ClearSpace({ spaceId, name, canClear, shared, demo }: { spaceId: string; name: string; canClear: boolean; shared: boolean; demo: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [left, setLeft] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  useEffect(() => stop, []);

  const run = async () => {
    const r = await clearSpace({ spaceId, confirmName: typed }).catch(() => ({ ok: false, error: x("No se ha podido completar.") }));
    setLeft(null);
    if (r.ok) { setMsg({ ok: true, text: x("Espacio vaciado.") }); setTyped(""); router.refresh(); }
    else setMsg({ ok: false, text: r.error ?? x("No se ha podido completar.") });
  };
  const start = () => {
    setMsg(null);
    if (demo) { setMsg({ ok: false, text: x("Crea una cuenta para guardar") }); return; }
    setLeft(DELAY);
    let n = DELAY;
    timer.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { stop(); void run(); } else setLeft(n);
    }, 1000);
  };
  const undo = () => { stop(); setLeft(null); setMsg({ ok: true, text: x("No se ha borrado nada.") }); };

  if (!canClear) return <p className="rounded-card border border-border bg-surface-2 p-3 text-sm text-ink-2">{x("Solo quien creó este espacio puede vaciarlo.")}</p>;
  const match = typed.trim().toLowerCase() === name.trim().toLowerCase();
  return (
    <div className="flex flex-col gap-3 rounded-card border border-over p-4">
      <h3 className="font-semibold text-over-text">{x("Vaciar este espacio")}</h3>
      <p className="text-sm text-ink-2">{x("Borra los gastos, ingresos, plan, gastos fijos, metas y préstamos de este espacio. No toca tu cuenta ni tus otros espacios.")}{shared ? ` ${x("Avisaremos a los demás miembros.")}` : ""}</p>
      {left === null ? (
        <>
          <label className="flex flex-col gap-1 text-sm text-ink-2">{x("Escribe")} <strong className="text-ink">{name}</strong> {x("para confirmar")}
            <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={60} autoComplete="off" className="min-h-12 rounded-card border border-border bg-surface px-4 text-base text-ink" />
          </label>
          <button type="button" disabled={!match} onClick={start} className="min-h-12 rounded-full border border-over font-semibold text-over-text disabled:opacity-50">{x("Vaciar este espacio")}</button>
        </>
      ) : (
        <div role="status" className="flex items-center justify-between gap-3 rounded-card bg-surface-2 p-3">
          <span className="text-sm">{x("Se vaciará en")} <span className="money font-mono">{left}</span> s</span>
          <button type="button" onClick={undo} className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent">{x("Deshacer")}</button>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ink-2" : "text-over-text"}`}>{msg.text}</p>}
    </div>
  );
}
