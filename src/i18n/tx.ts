import "server-only";
import { getLocale } from "next-intl/server";
import { renameEs } from "./es-rename";
import enUi from "../../messages/en-ui.json";

import type { Tx } from "./tx-types";
export type { Tx };

/** Traductor para servidor: el texto fuente está en español y se busca su versión en inglés (si no existe, se deja en español). */
export async function getTx(): Promise<Tx> {
  const l = await getLocale();
  const dict = enUi as Record<string, string>;
  const fn = ((es: string) => (l === "en" ? (dict[es] ?? es) : renameEs(es))) as Tx;
  fn.locale = l === "en" ? "en-GB" : "es-ES";
  return fn;
}
