"use client";

import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // updateViaCache: "none" → el script del service worker nunca se sirve desde la caché HTTP
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((reg) => {
      reg.update().catch(() => undefined);
    }).catch(() => undefined);
  }, []);
  return null;
}
