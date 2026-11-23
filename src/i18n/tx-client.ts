"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import enUi from "../../messages/en-ui.json";
import type { Tx } from "./tx-types";

/** Traductor para componentes de cliente (misma lógica que `getTx`). */
export function useTx(): Tx {
  const l = useLocale();
  return useMemo(() => {
    const dict = enUi as Record<string, string>;
    const fn = (es: string) => (l === "en" ? (dict[es] ?? es) : es);
    return Object.assign(fn, { locale: l === "en" ? "en-GB" : "es-ES" });
  }, [l]);
}
