"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTx } from "@/i18n/tx-client";
import { setIncomeSkip } from "@/server/actions/income-rules";

/** «Saltar este cobro» (y deshacerlo) de un cobro que aún no ha llegado. */
export function SkipPayday({ ruleId, date, skipped }: { ruleId: string; date: string; skipped: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = () => {
    setError(null);
    start(async () => {
      const r = await setIncomeSkip({ ruleId, date, skip: !skipped }).catch(() => ({ ok: false as const, error: x("No se ha podido completar.") }));
      if (!r.ok) setError(r.error ?? x("No se ha podido completar."));
      else router.refresh();
    });
  };
  return (
    <>
      <button type="button" disabled={pending} onClick={toggle} className="min-h-11 flex-1 rounded-full border border-border px-4 text-sm font-semibold">{skipped ? x("Volver a contarlo") : x("Saltar este cobro")}</button>
      {error && <p role="alert" className="text-sm text-over-text">{error}</p>}
    </>
  );
}
