"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** El «Borrar…» de una pantalla de detalle: siempre abajo del todo, con confirmación. Los textos llegan ya traducidos. */
export function DetailDelete({ label, title, description, action }: {
  label: string; title: string; description: string; action: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="min-h-12 w-full rounded-full border border-over font-semibold text-over-text">{label}</button>
      {open && <ConfirmDialog title={title} description={description} onConfirm={action} onClose={() => setOpen(false)} />}
    </>
  );
}
