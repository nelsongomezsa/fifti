"use client";

import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";

/**
 * Las pantallas ya vistas salen al instante desde la caché del cliente. Al llegar a una, se pide la versión nueva
 * por detrás y se cambia sin parpadeo (si no hay cambios, no se nota). Se limita a una vez cada 20 s por pantalla.
 */
export function RefreshOnNav() {
  const path = usePathname();
  const router = useRouter();
  const last = useRef(new Map<string, number>());
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; last.current.set(path, Date.now()); return; }
    const t = last.current.get(path);
    last.current.set(path, Date.now());
    if (t === undefined || Date.now() - t < 20_000) return; // primera visita: ya viene fresca del servidor
    const id = setTimeout(() => startTransition(() => router.refresh()), 150);
    return () => clearTimeout(id);
  }, [path, router]);
  return null;
}
