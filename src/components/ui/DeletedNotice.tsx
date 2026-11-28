"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTx } from "@/i18n/tx-client";
import { sheetContextChanged } from "@/lib/sheet-context";

/** Aviso breve al llegar con ?borrado=1; el parámetro se quita de la URL para que no reaparezca al recargar. */
export function DeletedNotice() {
  const x = useTx();
  const path = usePathname();
  const params = useSearchParams();
  const value = params.get("borrado");
  // «1» según la pantalla; los demás borrados dicen qué eran
  const named = value === "meta" ? "Meta borrada" : value === "espacio" ? "Espacio borrado" : value === "salida" ? "Has salido del espacio" : null;
  const flag = value === "1" || named !== null;
  const [seen, setSeen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (flag !== seen) {
    setSeen(flag);
    if (flag) setMessage(named ?? (path === "/plan" ? "Gasto fijo borrado" : path === "/cuentas" ? "Cuenta borrada" : "Gasto borrado"));
  }

  useEffect(() => {
    if (flag && path === "/cuentas") sheetContextChanged();
  }, [flag, path]);

  useEffect(() => {
    if (!flag) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("borrado");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [flag]);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  if (!message) return null;
  return (
    <p role="status" className="anim-fade fixed inset-x-4 bottom-[calc(7rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-card border border-border bg-surface-2 px-4 py-3 text-center text-sm shadow-lg">
      {x(message)}
    </p>
  );
}
