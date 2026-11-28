"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTx } from "@/i18n/tx-client";
import { removeExpenseTag } from "@/server/actions/categories";

/** Etiquetas de un gasto; quien puede editarlo puede quitárselas. */
export function TagChips({ expenseId, tags, canEdit }: { expenseId: string; tags: { id: string; name: string }[]; canEdit: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const remove = (tagId: string) => {
    setError(null);
    start(async () => {
      const r = await removeExpenseTag({ expenseId, tagId }).catch(() => ({ ok: false as const, error: x("No se ha podido completar.") }));
      if (!r.ok) { setError(r.error ?? x("No se ha podido completar.")); return; }
      router.refresh();
    });
  };

  return (
    <>
      <ul className="mt-2 flex flex-wrap gap-2">
        {tags.map((t) => (
          <li key={t.id} className="flex items-center rounded-full border border-border pl-3 text-xs text-ink-2">
            #{t.name}
            {canEdit
              ? <button type="button" disabled={pending} onClick={() => remove(t.id)} aria-label={`${x("Quitar la etiqueta")} ${t.name}`} className="grid min-h-11 min-w-11 place-items-center text-ink-3">✕</button>
              : <span className="py-1 pr-3" />}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-xs text-over-text">{error}</p>}
    </>
  );
}
