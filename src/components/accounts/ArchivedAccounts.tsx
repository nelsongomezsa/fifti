"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DeleteAccountDialog } from "@/components/accounts/DeleteAccount";
import { useTx } from "@/i18n/tx-client";
import { formatMoney } from "@/lib/money";
import { sheetContextChanged } from "@/lib/sheet-context";
import { archiveAccount } from "@/server/actions/accounts";

type Row = { id: string; name: string; color: string; currency: string; balanceCents: number; shared: boolean };

/** Cuentas archivadas: se ocultan sin perder el historial; aquí se ven, se recuperan o se borran. */
export function ArchivedAccounts({ accounts, demo }: { accounts: Row[]; demo: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const restore = (id: string) => {
    setError(null);
    if (demo) { setError(x("Crea una cuenta para guardar")); return; }
    start(async () => {
      const r = await archiveAccount({ id, archived: false }).catch(() => ({ ok: false as const, error: x("No se ha podido completar.") }));
      if (!r.ok) { setError(r.error ?? x("No se ha podido completar.")); return; }
      sheetContextChanged();
      router.refresh();
    });
  };

  return (
    <details className="rounded-card border border-border bg-surface p-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{x("Archivadas")} ({accounts.length})</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
            <Link href={`/cuentas/${a.id}`} className="flex min-h-11 items-center gap-3 text-sm">
              <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: a.color }} />
              <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
              <span className="money shrink-0 font-mono">{formatMoney(a.balanceCents, a.currency, x.locale)}</span>
            </Link>
            <div className="flex gap-2">
              <button type="button" disabled={pending} onClick={() => restore(a.id)} className="min-h-11 flex-1 rounded-full border border-border text-sm font-semibold">{x("Recuperar")}</button>
              <button type="button" disabled={pending} onClick={() => setDeleting(a)} className="min-h-11 flex-1 rounded-full border border-over text-sm font-semibold text-over-text">{x("Borrar")}</button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-over-text">{error}</p>}
      {deleting && <DeleteAccountDialog id={deleting.id} name={deleting.name} shared={deleting.shared} demo={demo} onClose={() => setDeleting(null)} />}
    </details>
  );
}
