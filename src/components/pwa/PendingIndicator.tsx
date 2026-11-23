"use client";


import { useTx } from "@/i18n/tx-client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { flushQueue, listQueue, removeItem, type QueueItem } from "@/lib/offline/queue";
import { QUEUE_EVENT } from "@/lib/offline/submit";
import { saveExpense } from "@/server/actions/expenses";

/** Indicador "pendiente de subir" + sincronización automática al volver la conexión. */
export function PendingIndicator() {
  const x = useTx();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try { setItems(await listQueue()); } catch { setItems([]); }
  }, []);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const r = await flushQueue(async (input) => {
        const res = await saveExpense(input);
        return res.ok ? { ok: true, id: res.id } : res;
      });
      if (r.sent > 0) router.refresh();
    } catch { /* se reintenta en el siguiente evento */ }
    await refresh();
  }, [refresh, router]);

  useEffect(() => {
    const t = setTimeout(() => { setOnline(navigator.onLine); void refresh(); void sync(); }, 0);
    const onOnline = () => { setOnline(true); void sync(); };
    const onOffline = () => setOnline(false);
    const onQueue = () => { void refresh(); void sync(); };
    const onVisible = () => { if (document.visibilityState === "visible") void sync(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(QUEUE_EVENT, onQueue);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => void sync(), 60_000);
    return () => {
      clearTimeout(t); clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(QUEUE_EVENT, onQueue);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, sync]);

  const pending = items.filter((i) => i.status === "pending");
  const failed = items.filter((i) => i.status === "failed");
  if (online && items.length === 0) return null;

  return (
    <div className="px-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-card border border-border bg-surface px-4 text-left text-sm text-ink-2">
        <span aria-hidden className="size-2 rounded-full" style={{ background: online ? "var(--warn)" : "var(--over)" }} />
        {!online ? x("Sin conexión. ") : ""}
        {pending.length > 0 && `${pending.length} ${pending.length === 1 ? "gasto pendiente" : "gastos pendientes"} de subir`}
        {failed.length > 0 && ` · ${failed.length} con error`}
        {pending.length === 0 && failed.length === 0 && x("Estás sin conexión: puedes seguir apuntando gastos.")}
      </button>
      {open && failed.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {failed.map((f) => (
            <li key={f.clientId} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
              <span>{f.input.description}<span className="block text-xs text-over-text">{f.error}</span></span>
              <button type="button" className="min-h-11 px-3 text-over-text" onClick={async () => { await removeItem(f.clientId); await refresh(); }}>{x("Descartar")}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
