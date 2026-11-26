"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTx } from "@/i18n/tx-client";
import { deleteExpense } from "@/server/actions/expenses";
import { deleteRecurring } from "@/server/actions/plan";

const OPEN = 168; // ancho de los dos botones
const UNDO_MS = 5000;

/** Fila deslizable: a la izquierda se descubren Editar y Borrar. Borrar se puede deshacer durante 5 s; los botones también son alcanzables desde el detalle del gasto. */
export function SwipeRow({ id, kind = "expense", children }: { id: string; kind?: "expense" | "recurring"; children: React.ReactNode }) {
  const x = useTx();
  const router = useRouter();
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const [state, setState] = useState<"idle" | "removed" | "error">("idle");
  const [msg, setMsg] = useState("");
  const start = useRef<{ x: number; y: number; base: number; horizontal: boolean | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  const commit = async () => {
    if (!pending.current) return;
    pending.current = false;
    const r = kind === "recurring"
      ? await (async () => { const fd = new FormData(); fd.set("recurringId", id); await deleteRecurring(fd); return { ok: true as const, error: undefined }; })().catch(() => ({ ok: false as const, error: x("No se ha podido completar.") }))
      : await deleteExpense(id).catch(() => ({ ok: false as const, error: x("No se ha podido completar.") }));
    if (!r.ok) { setMsg(r.error ?? x("No se ha podido completar.")); setState("error"); setTimeout(() => setState("idle"), 4000); return; }
    router.refresh();
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); void commit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = () => {
    setDx(0); setState("removed"); pending.current = true;
    timer.current = setTimeout(() => { void commit(); setState((s) => (s === "removed" ? "idle" : s)); }, UNDO_MS);
  };
  const undo = () => { if (timer.current) clearTimeout(timer.current); pending.current = false; setState("idle"); };

  const onStart = (e: React.TouchEvent) => { const t = e.touches[0]!; start.current = { x: t.clientX, y: t.clientY, base: dx, horizontal: null }; setDrag(true); };
  const onMove = (e: React.TouchEvent) => {
    const s = start.current; if (!s) return;
    const t = e.touches[0]!; const mx = t.clientX - s.x, my = t.clientY - s.y;
    if (s.horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) s.horizontal = Math.abs(mx) > Math.abs(my);
    if (s.horizontal) setDx(Math.max(-OPEN, Math.min(0, s.base + mx)));
  };
  const onEnd = () => { setDrag(false); if (start.current?.horizontal) setDx((d) => (d < -OPEN / 3 ? -OPEN : 0)); start.current = null; };

  if (state === "removed") {
    return (
      <div role="status" className="anim-fade flex min-h-14 items-center justify-between gap-3 rounded-card border border-dashed border-border px-4 text-sm text-ink-2">
        <span>{kind === "recurring" ? x("Gasto fijo borrado") : x("Gasto borrado")}</span>
        <button type="button" onClick={undo} className="min-h-11 px-3 font-semibold text-ink">{x("Deshacer")}</button>
      </div>
    );
  }
  const opened = dx < -OPEN / 2;
  return (
    <div className="relative overflow-hidden rounded-card">
      <div className="absolute inset-y-0 right-0 flex" style={{ width: OPEN }} aria-hidden={!opened}>
        <Link href={kind === "recurring" ? `/fijos/nuevo?id=${id}` : `/movimientos/${id}?editar=1`} tabIndex={opened ? 0 : -1} className="flex flex-1 items-center justify-center bg-surface-2 text-sm font-semibold text-ink">{x("Editar")}</Link>
        <button type="button" tabIndex={opened ? 0 : -1} onClick={remove} className="flex flex-1 items-center justify-center bg-over text-sm font-semibold text-on-accent">{x("Borrar")}</button>
      </div>
      <div className="relative touch-pan-y bg-bg" style={{ transform: `translateX(${dx}px)`, transition: drag ? "none" : "transform 160ms ease-out" }} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
        {children}
      </div>
      {state === "error" && <p role="alert" className="absolute inset-x-0 bottom-0 bg-surface-2 px-3 py-1 text-center text-xs text-over-text">{msg}</p>}
    </div>
  );
}
