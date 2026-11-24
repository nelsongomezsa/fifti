"use client";

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTx } from "@/i18n/tx-client";
import { formatMoney, parseToCents } from "@/lib/money";
import { addShoppingItem, finishShopping, realtimeAccess, removeShoppingItem, toggleShoppingItem, type ShoppingItem } from "@/server/actions/shopping";

/** Lista de la compra compartida: cambios al instante, en directo para todos los miembros (Realtime con RLS) y con sondeo de respaldo. */
export function ShoppingList({ spaceId, items: initial, names, currency }: { spaceId: string; items: ShoppingItem[]; names: Record<string, string>; currency: string }) {
  const x = useTx();
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [items, setItems] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [text, setText] = useState("");
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [total, setTotal] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cuando el servidor trae una lista nueva (refresh), sustituye a la local
  if (initial !== seen) { setSeen(initial); setItems(initial); }

  useEffect(() => {
    const refresh = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => startRefresh(() => router.refresh()), 250); };
    let stopped = false;
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    let channel: ReturnType<typeof sb.channel> | null = null;
    void (async () => {
      const access = await realtimeAccess().catch(() => null);
      if (!access || stopped) return;
      sb.realtime.setAuth(access.token);
      channel = sb.channel(`shopping:${spaceId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items", filter: `space_id=eq.${spaceId}` }, refresh)
        .subscribe((status) => setLive(status === "SUBSCRIBED"));
    })();
    // Respaldo: si Realtime no conecta, se actualiza cada 20 s mientras la pestaña está visible
    const poll = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 20000);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true; clearInterval(poll); document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      if (channel) void sb.removeChannel(channel);
      void sb.realtime.disconnect();
    };
  }, [spaceId, router]);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    const tmp: ShoppingItem = { id: `tmp-${crypto.randomUUID()}`, text: t, quantity: qty, checked: false, addedBy: null };
    setItems((l) => [...l, tmp]); setText(""); setQty(1);
    const r = await addShoppingItem({ spaceId, text: t, quantity: qty });
    if (!r.ok || !r.item) { setItems((l) => l.filter((i) => i.id !== tmp.id)); setError(r.ok ? x("No se ha podido completar.") : r.error); return; }
    setItems((l) => l.map((i) => (i.id === tmp.id ? r.item! : i)));
  };
  const toggle = async (it: ShoppingItem) => {
    setItems((l) => l.map((i) => (i.id === it.id ? { ...i, checked: !it.checked } : i)));
    const r = await toggleShoppingItem({ spaceId, id: it.id, checked: !it.checked });
    if (!r.ok) { setItems((l) => l.map((i) => (i.id === it.id ? it : i))); setError(r.error); }
  };
  const remove = async (it: ShoppingItem) => {
    setItems((l) => l.filter((i) => i.id !== it.id));
    const r = await removeShoppingItem({ spaceId, id: it.id });
    if (!r.ok) { setItems((l) => [...l, it]); setError(r.error); }
  };
  const finish = async () => {
    const cents = parseToCents(total);
    if (!cents) { setError(x("Pon el total de la compra.")); return; }
    setBusy(true); setError(null);
    const r = await finishShopping({ spaceId, totalCents: cents });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setFinishing(false); setTotal("");
    setDone(r.expenseId ?? null);
    startRefresh(() => router.refresh());
  };

  const pending = items.filter((i) => !i.checked), got = items.filter((i) => i.checked);
  const row = (it: ShoppingItem) => (
    <li key={it.id} className="flex items-center gap-2 rounded-card border border-border bg-surface px-3">
      <label className="flex min-h-12 flex-1 items-center gap-3">
        <input type="checkbox" checked={it.checked} onChange={() => void toggle(it)} className="size-5" aria-label={it.text} />
        <span className={`min-w-0 flex-1 ${it.checked ? "text-ink-3 line-through" : ""}`}>
          <span className="block truncate">{it.text}{it.quantity > 1 && <span className="ml-1 font-mono text-ink-3">×{it.quantity}</span>}</span>
          {it.addedBy && names[it.addedBy] && <span className="block text-xs text-ink-3">{names[it.addedBy]}</span>}
        </span>
      </label>
      <button type="button" onClick={() => void remove(it)} aria-label={`${x("Quitar")} ${it.text}`} className="grid min-h-11 min-w-11 place-items-center text-ink-3">✕</button>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-3" aria-live="polite">{live ? x("En directo: los cambios de los demás aparecen al momento.") : x("Se actualiza cada pocos segundos.")}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={120} placeholder={x("Leche")} aria-label={x("Artículo")} className="min-h-12 min-w-0 flex-1 rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3" />
        <input type="number" inputMode="numeric" min={1} max={999} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(999, Number(e.target.value) || 1)))} aria-label={x("Cantidad")} className="min-h-12 w-16 rounded-card border border-border bg-surface px-2 text-center font-mono text-ink" />
        <button type="submit" disabled={!text.trim()} className="min-h-12 shrink-0 rounded-full bg-accent px-5 font-semibold text-on-accent disabled:opacity-50">{x("Añadir")}</button>
      </form>
      {error && <p role="alert" className="text-sm text-over-text">{error}</p>}
      {done && <p role="status" className="text-sm text-ink-2">{x("Compra guardada.")} <Link href={`/movimientos/${done}`} className="underline">{x("Ver el gasto")}</Link></p>}

      {items.length === 0 ? <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{x("La lista está vacía. Añade lo que falte en casa.")}</p> : (
        <>
          <ul className="flex flex-col gap-2">{pending.map(row)}</ul>
          {got.length > 0 && (<><h2 className="text-sm text-ink-3">{x("En el carro")} ({got.length})</h2><ul className="flex flex-col gap-2">{got.map(row)}</ul></>)}
        </>
      )}

      {items.length > 0 && <button type="button" onClick={() => setFinishing(true)} className="min-h-12 rounded-full border border-border px-6 font-semibold">{x("Terminar compra")}</button>}

      {finishing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => !busy && setFinishing(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="fin-title" onClick={(e) => e.stopPropagation()} className="anim-sheet m-4 w-full max-w-sm rounded-[24px] border border-border bg-surface-2 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <h2 id="fin-title" className="text-lg font-bold">{x("Terminar compra")}</h2>
            <p className="mt-1 text-sm text-ink-2">{x("Dinos cuánto ha sido. Se apunta como gasto de esta burbuja, en Súper y repartido como siempre, con los artículos marcados como nota. Lo que no hayas marcado pasa a la lista nueva.")}</p>
            <input autoFocus value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="45,30" aria-label={x("Total de la compra")} className="mt-3 min-h-12 w-full rounded-card border border-border bg-surface px-4 font-mono text-lg text-ink" />
            {parseToCents(total) ? <p className="mt-1 text-xs text-ink-3">{formatMoney(parseToCents(total)!, currency, x.locale)}</p> : null}
            {error && <p role="alert" className="mt-2 text-sm text-over-text">{error}</p>}
            <div className="mt-4 flex gap-3">
              <button type="button" disabled={busy} onClick={() => setFinishing(false)} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Cancelar")}</button>
              <button type="button" disabled={busy || !parseToCents(total)} onClick={() => void finish()} className="min-h-12 flex-1 rounded-full bg-accent font-semibold text-on-accent disabled:opacity-50">{busy ? x("Guardando…") : x("Guardar")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
