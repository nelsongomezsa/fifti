"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTx } from "@/i18n/tx-client";

/**
 * Hoja inferior para los detalles cortos (ingresos, tasa de ahorro, previsión, fondo, gasto).
 * Se cierra arrastrando el asa hacia abajo, tocando fuera, con Escape o con el botón. Se abre por una ruta "interceptada":
 * al entrar desde la app es una hoja sobre la pantalla; al abrir el enlace directamente es la página completa.
 */
export function SheetShell({ children, onClose, label }: { children: React.ReactNode; onClose?: () => void; label?: string }) {
  const x = useTx();
  const router = useRouter();
  const [dy, setDy] = useState(0);
  const [drag, setDrag] = useState(false);
  const startY = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => (onClose ? onClose() : router.back());

  useEffect(() => {
    panel.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = ({ key }: KeyboardEvent) => { if (key === "Escape") (onClose ? onClose() : router.back()); };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKeyDown); };
  }, [router, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label={x("Cerrar")} tabIndex={-1} onClick={close} className="absolute inset-0 bg-black/60" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className="anim-sheet relative flex max-h-[calc(92dvh-env(safe-area-inset-top))] w-full max-w-md flex-col rounded-t-[24px] border border-b-0 border-border bg-bg outline-none"
        style={{ transform: `translateY(${dy}px)`, transition: drag ? "none" : "transform 180ms ease-out", boxShadow: "var(--elev-2)" }}>
        <div className="flex shrink-0 touch-none items-center justify-between px-3 pt-2"
          onTouchStart={(e) => { startY.current = e.touches[0]!.clientY; setDrag(true); }}
          onTouchMove={(e) => { if (startY.current !== null) setDy(Math.max(0, e.touches[0]!.clientY - startY.current)); }}
          onTouchEnd={() => { setDrag(false); startY.current = null; if (dy > 110) close(); else setDy(0); }}
          onTouchCancel={() => { setDrag(false); setDy(0); startY.current = null; }}>
          <span className="w-11" aria-hidden />
          <span aria-hidden className="mb-2 mt-1 h-1.5 w-10 rounded-full bg-track" />
          <button type="button" onClick={close} aria-label={x("Cerrar")} className="grid min-h-11 min-w-11 place-items-center text-ink-2">✕</button>
        </div>
        <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
