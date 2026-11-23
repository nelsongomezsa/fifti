import "server-only";

/**
 * Tipo de cambio aplicado a un gasto: 1 unidad de `from` = X unidades de la moneda base.
 * Misma moneda = 1. (La consulta a la API de tipos de cambio se añade en la fase 9.)
 */
export async function resolveFx(base: string, from: string, _date: string): Promise<number | null> {
  if (base === from) return 1;
  return null;
}
