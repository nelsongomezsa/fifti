"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Foco y Escape de una hoja. El foco se pone UNA vez, al abrir: quien la pinta suele pasar `onClose={() => …}`, una función
 * nueva en cada render, y un efecto que dependiera de ella devolvería el foco al panel a cada tecla.
 */
export function useSheetFocus(panel: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    // Si un campo de la hoja ya pidió el foco (autoFocus), se respeta
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === "Escape") close.current(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel]);
}
