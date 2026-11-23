"use client";

import { useEffect } from "react";
import { CTX_CACHE_KEY } from "@/components/nav/PlusButton";

/** En la pantalla de entrada se borran los datos guardados en el dispositivo por la sesión anterior. */
export function ClearLocalData() {
  useEffect(() => {
    try { localStorage.removeItem(CTX_CACHE_KEY); } catch { /* sin almacenamiento */ }
    navigator.serviceWorker?.controller?.postMessage("clear");
  }, []);
  return null;
}
