"use client";

import { usePathname } from "next/navigation";

/** Oculta su contenido en las rutas indicadas (p. ej. los chips de espacios en Ajustes). */
export function HideOn({ prefixes, children }: { prefixes: string[]; children: React.ReactNode }) {
  const path = usePathname();
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`)) ? null : <>{children}</>;
}
