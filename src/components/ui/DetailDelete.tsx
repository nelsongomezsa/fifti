"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** El «Borrar…» de una pantalla de detalle: siempre abajo del todo, con confirmación. Los textos llegan ya traducidos. */
export function DetailDelete({ label, title, description, action }: {
  label: string; title: string; description: string; action: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Si la acción redirige no vuelve; si solo borra, se refresca la pantalla en la que estamos
  const run = async () => {
    const r = await action();
    if (r?.ok) router.refresh();
    return r;
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="min-h-12 w-full rounded-full border border-over font-semibold text-over-text">{label}</button>
      {open && <ConfirmDialog title={title} description={description} onConfirm={run} onClose={() => setOpen(false)} />}
    </>
  );
}
