/** La hoja de «Nuevo gasto» guarda las cuentas en memoria y en el dispositivo: al borrar o archivar una hay que releerlas. */
export const SHEET_CONTEXT_STALE = "fifti:sheet-context-stale";

export function sheetContextChanged() {
  window.dispatchEvent(new Event(SHEET_CONTEXT_STALE));
}
