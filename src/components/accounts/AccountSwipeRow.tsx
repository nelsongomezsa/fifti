"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { DeleteAccountDialog } from "@/components/accounts/DeleteAccount";
import { useTx } from "@/i18n/tx-client";
import { sheetContextChanged } from "@/lib/sheet-context";
import { archiveAccount } from "@/server/actions/accounts";

const OPEN = 112; // ancho del botón que se descubre a cada lado

/**
 * Fila de «Mis cuentas» deslizable, como las de Movimientos: a la izquierda descubre Borrar y a la derecha Archivar.
 * Deslizar solo descubre; hace falta tocar el botón. Con eventos de puntero sirve para el dedo y para el ratón, y
 * `touch-pan-y` deja el desplazamiento vertical al navegador.
 */
export function AccountSwipeRow({ id, name, shared, demo, children }: { id: string; name: string; shared: boolean; demo: boolean; children: React.ReactNode }) {
  const x = useTx();
  const router = useRouter();
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const gesture = useRef<{ x: number; y: number; base: number; horizontal: boolean } | null>(null);
  const swiped = useRef(false); // el clic que sigue a un deslizamiento no abre la cuenta

  const onDown = (e: React.PointerEvent) => {
    swiped.current = false;
    if (e.button !== 0) return;
    gesture.current = { x: e.clientX, y: e.clientY, base: dx, horizontal: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const mx = e.clientX - g.x, my = e.clientY - g.y;
    if (!g.horizontal) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      // Solo es deslizar si va claramente de lado; en diagonal o hacia abajo es desplazar la página
      if (Math.abs(mx) < Math.abs(my) * 1.5) { gesture.current = null; return; }
      g.horizontal = true;
      swiped.current = true;
      setDrag(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDx(Math.max(-OPEN, Math.min(OPEN, g.base + mx)));
  };
  const onEnd = () => {
    const g = gesture.current;
    gesture.current = null;
    setDrag(false);
    if (!g?.horizontal) return;
    // Para abrir basta un tercio; una ya abierta se cierra en cuanto se empuja de vuelta
    setDx((d) => (Math.abs(d) > (g.base === 0 ? OPEN / 3 : (OPEN * 2) / 3) ? Math.sign(d) * OPEN : 0));
  };

  const archive = () => {
    setError(null);
    if (demo) { setError(x("Crea una cuenta para guardar")); return; }
    start(async () => {
      const r = await archiveAccount({ id, archived: true }).catch(() => ({ ok: false as const, error: x("No se ha podido completar.") }));
      if (!r.ok) { setError(r.error ?? x("No se ha podido completar.")); return; }
      sheetContextChanged();
      router.refresh();
    });
  };

  const left = dx > OPEN / 2, right = dx < -OPEN / 2;
  return (
    <>
      <div className="relative overflow-hidden rounded-card">
        <button type="button" tabIndex={left ? 0 : -1} aria-hidden={!left} disabled={pending} onClick={archive}
          className={`absolute inset-y-0 left-0 bg-surface-2 text-sm font-semibold text-ink ${dx > 0 ? "" : "invisible"}`} style={{ width: OPEN }}>{x("Archivar")}</button>
        <button type="button" tabIndex={right ? 0 : -1} aria-hidden={!right} onClick={() => { setDx(0); setConfirming(true); }}
          className={`absolute inset-y-0 right-0 bg-over text-sm font-semibold text-on-accent ${dx < 0 ? "" : "invisible"}`} style={{ width: OPEN }}>{x("Borrar")}</button>
        <div className="relative touch-pan-y select-none bg-bg" style={{ transform: `translateX(${dx}px)`, transition: drag ? "none" : "transform 160ms ease-out" }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd} onDragStart={(e) => e.preventDefault()}
          onClickCapture={(e) => {
            if (!swiped.current && dx === 0) return;
            e.preventDefault(); e.stopPropagation();
            if (!swiped.current) setDx(0); // tocar una fila abierta la cierra
            swiped.current = false;
          }}>
          {children}
        </div>
      </div>
      {error && <p role="alert" className="mt-1 text-sm text-over-text">{error}</p>}
      {confirming && <DeleteAccountDialog id={id} name={name} shared={shared} demo={demo} onClose={() => setConfirming(false)} />}
    </>
  );
}
