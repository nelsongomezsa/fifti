"use client";

import { useEffect, useState } from "react";
import { useTx } from "@/i18n/tx-client";
import { dismissSwipeHint } from "@/server/actions/swipe-hint";

/**
 * Pista de la primera vez. Viene pintada del servidor para no mover la lista al cargar; donde no hay dedo la oculta el CSS.
 * Al verse queda apuntada y no vuelve a salir.
 */
export function SwipeHintBanner() {
  const x = useTx();
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (window.matchMedia("(pointer: coarse)").matches) void dismissSwipeHint().catch(() => {}); }, []);
  if (closed) return null;
  return (
    <p className="flex items-center justify-between gap-2 rounded-card border border-dashed border-border px-3 text-sm text-ink-2 [@media(pointer:fine)]:hidden">
      <span className="py-2">{x("Desliza una fila para borrarla o editarla")}</span>
      <button type="button" onClick={() => setClosed(true)} aria-label={x("Cerrar")} className="grid min-h-11 min-w-11 shrink-0 place-items-center text-ink-3">✕</button>
    </p>
  );
}
