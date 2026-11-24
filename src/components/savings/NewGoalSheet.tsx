"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { useTx } from "@/i18n/tx-client";
import { createGoal } from "@/server/actions/savings";

/** "Nueva meta": botón que abre una hoja con el formulario (ya no es un <details>). */
export function NewGoalSheet({ spaceId }: { spaceId: string }) {
  const x = useTx();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKeyDown = (ev: KeyboardEvent) => { const { key } = ev; if (key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="min-h-12 rounded-full bg-accent px-6 font-semibold text-on-accent">{x("Nueva meta")}</button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={x("Nueva meta")} onClick={(e) => e.stopPropagation()}
            className="anim-sheet flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-[24px] border border-border bg-surface-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">{x("Nueva meta")}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label={x("Cerrar")} className="grid min-h-11 min-w-11 place-items-center text-ink-2">✕</button>
            </div>
            <ActionForm action={createGoal} submit={x("Crear meta")} className="flex flex-col gap-3">
              <input type="hidden" name="spaceId" value={spaceId} />
              <select name="kind" defaultValue="simple" aria-label={x("Tipo")} className={inputClass}>
                <option value="simple">{x("Meta simple")}</option><option value="big_event">{x("Meta grande con pagos (boda, piso)")}</option><option value="challenge">{x("Reto de las 52 semanas")}</option>
              </select>
              <input name="name" required maxLength={60} placeholder={x("Viaje Lisboa")} aria-label={x("Nombre")} className={inputClass} />
              <input name="target" inputMode="decimal" placeholder={x("Objetivo (1.500,00). No hace falta en el reto")} aria-label={x("Objetivo")} className={`${inputClass} font-mono`} />
              <label className="flex flex-col gap-1 text-xs text-ink-3">{x("Fecha límite (opcional)")}<input type="date" name="deadline" className={inputClass} /></label>
            </ActionForm>
          </div>
        </div>
      )}
    </>
  );
}
