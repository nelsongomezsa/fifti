"use client";

import { useState } from "react";
import { SheetShell } from "./SheetShell";

/** Botón que abre una hoja inferior con su contenido (sustituye a los <details> con triángulo). */
export function SheetButton({ label, title, children, tone = "plain", className }: { label: string; title?: string; children: React.ReactNode; tone?: "plain" | "accent"; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className={className ?? `min-h-12 rounded-full px-5 font-semibold ${tone === "accent" ? "bg-accent text-on-accent" : "border border-border text-ink"}`}>{label}</button>
      {open && (
        <SheetShell onClose={() => setOpen(false)} label={title ?? label}>
          <h2 className="mb-3 text-xl font-bold">{title ?? label}</h2>
          {children}
        </SheetShell>
      )}
    </>
  );
}
