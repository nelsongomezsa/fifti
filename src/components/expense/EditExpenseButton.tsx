"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadSheetContext, type SheetContext } from "@/server/actions/sheet";
import { ExpenseSheet, type SheetPrefill } from "./ExpenseSheet";

export function EditExpenseButton({ prefill, spaceId }: { prefill: SheetPrefill; spaceId: string }) {
  const [ctx, setCtx] = useState<SheetContext | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" className="min-h-11 rounded-full border border-border px-5 font-semibold"
        onClick={async () => { setCtx(await loadSheetContext()); setOpen(true); }}>
        Editar
      </button>
      {open && ctx && (
        <ExpenseSheet ctx={ctx} defaultSpaceId={spaceId} prefill={prefill} onClose={() => setOpen(false)} onSaved={() => router.refresh()} />
      )}
    </>
  );
}
