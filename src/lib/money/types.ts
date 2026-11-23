/** Céntimos: siempre enteros (en Postgres, bigint). Nunca floats. */
export type Cents = number;
/** Puntos básicos: 10000 = 100 %. */
export type BasisPoints = number;

export const BP_TOTAL = 10_000;
/** Tope de seguridad por importe: 1.000.000.000,00 */
export const MAX_AMOUNT_CENTS = 100_000_000_000;

export function assertCents(value: number, label = "importe"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} debe ser un entero en céntimos`);
  }
}
