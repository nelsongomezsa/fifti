"use client";

import { useEffect } from "react";

/** Al llegar con un ancla (#gastos-fijos) baja hasta esa sección cuando ya está pintada (con las pantallas en streaming el navegador no la encuentra a tiempo). */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }), 60);
    return () => clearTimeout(t);
  }, []);
  return null;
}
