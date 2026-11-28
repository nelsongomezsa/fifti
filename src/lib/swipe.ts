/** Cuentas del gesto de deslizar, aparte del componente para poder probarlas. */
export const REVEAL = 96; // ancho del botón que se descubre
const SLOP = 10; // movimiento mínimo antes de decidir qué gesto es
const EDGE = 24; // el borde izquierdo es del gesto «atrás» del iPhone

/** null: aún no se sabe. Solo es horizontal si lo es claramente: ante la duda, es scroll. */
export function swipeAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return null;
  return Math.abs(dx) >= Math.abs(dy) * 1.5 ? "x" : "y";
}

export const fromEdge = (startX: number, dx: number) => startX < EDGE && dx > 0;

/** Distancia a partir de la cual soltar ejecuta la acción sin tocar el botón. */
export const fullSwipe = (width: number) => Math.max(180, width * 0.55);

export function clampOffset(offset: number, width: number, canLeft: boolean, canRight: boolean): number {
  return Math.max(canLeft ? -width : 0, Math.min(canRight ? width : 0, offset));
}

export type Release = "run-delete" | "run-secondary" | "open-delete" | "open-secondary" | "close";

export function release(offset: number, width: number): Release {
  if (offset <= -fullSwipe(width)) return "run-delete";
  if (offset >= fullSwipe(width)) return "run-secondary";
  if (offset <= -REVEAL / 2) return "open-delete";
  if (offset >= REVEAL / 2) return "open-secondary";
  return "close";
}
