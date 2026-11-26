"use client";

import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

/** Al abrir una pantalla desde la copia del service worker, cuando llega la versión nueva la página se refresca sin parpadeo. */
export function SwUpdateListener() {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "fifti-updated" && e.data.path === path) startTransition(() => router.refresh());
    };
    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, [router, path]);
  return null;
}
