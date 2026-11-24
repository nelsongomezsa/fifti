"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTx } from "@/i18n/tx-client";
import type { RuleHint } from "@/server/actions/expenses";
import { acceptRuleHint } from "@/server/actions/rules";
import { loadSheetContext, type SheetContext } from "@/server/actions/sheet";
import { ExpenseSheet, type SheetPrefill } from "./ExpenseSheet";

export function EditExpenseButton({ prefill, spaceId, label, autoOpen }: { prefill: SheetPrefill; spaceId: string; label?: string; autoOpen?: boolean }) {
  const x = useTx();
  const [ctx, setCtx] = useState<SheetContext | null>(null);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<RuleHint | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();
  // Llegar desde "Editar" en la lista: se abre la hoja de edición directamente
  useEffect(() => {
    if (!autoOpen) return;
    let live = true;
    void loadSheetContext().then((c) => { if (live) { setCtx(c); setOpen(true); } });
    return () => { live = false; };
  }, [autoOpen]);
  return (
    <>
      <button type="button" className="min-h-11 rounded-full border border-border px-5 font-semibold"
        onClick={async () => { setCtx(await loadSheetContext()); setOpen(true); }}>
        {label ?? x("Editar")}</button>
      {open && ctx && (
        <ExpenseSheet ctx={ctx} defaultSpaceId={spaceId} prefill={prefill} onClose={() => setOpen(false)}
          onSaved={(info) => { if (info.ruleHint) { setHint(info.ruleHint); setDone(false); } router.refresh(); }} />
      )}
      {hint && (
        <div role="status" className="anim-fade fixed inset-x-4 bottom-[calc(7rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-4 py-3 shadow-lg">
          <span className="text-sm">{done ? x("Regla creada.") : `${x("¿Crear la regla")} «${hint.text} → ${hint.categoryName}»?`}</span>
          <span className="flex shrink-0">
            {!done && <button type="button" className="min-h-11 px-3 text-sm font-semibold" onClick={async () => { const r = await acceptRuleHint({ spaceId: hint.spaceId, text: hint.text, categoryId: hint.categoryId }); if (r.ok) setDone(true); else setHint(null); }}>{x("Crear")}</button>}
            <button type="button" className="min-h-11 px-3 text-sm text-ink-2" onClick={() => setHint(null)}>{done ? x("Cerrar") : x("Ahora no")}</button>
          </span>
        </div>
      )}
    </>
  );
}
