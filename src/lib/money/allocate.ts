import { type BasisPoints, type Cents, BP_TOTAL, assertCents } from "./types";

/**
 * Reparte `total` céntimos según `weights` (cualquier peso entero >= 0) con el
 * método del mayor resto. La suma del resultado es SIEMPRE `total`.
 * Los empates se resuelven por orden de índice, así el resultado es determinista.
 * Un total negativo se reparte por simetría (devoluciones).
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total, "total");
  if (weights.length === 0) throw new RangeError("Hace falta al menos un peso");
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) throw new RangeError("Los pesos deben ser enteros >= 0");
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new RangeError("La suma de pesos no puede ser 0");

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  // BigInt para evitar desbordes intermedios (abs * peso)
  const bigSum = BigInt(sum);
  const base = weights.map((w) => (BigInt(abs) * BigInt(w)) / bigSum);
  const rema = weights.map((w) => (BigInt(abs) * BigInt(w)) % bigSum);

  let left = BigInt(abs) - base.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = rema[a]!;
      const rb = rema[b]!;
      if (ra === rb) return a - b;
      return ra > rb ? -1 : 1;
    });
  const out = base.map((b) => b);
  for (const i of order) {
    if (left <= 0n) break;
    if (weights[i]! === 0) continue;
    out[i] = out[i]! + 1n;
    left -= 1n;
  }
  return out.map((v) => sign * Number(v));
}

/** Reparto a partes iguales entre `n` personas. */
export function splitEqual(total: Cents, n: number): Cents[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("n debe ser >= 1");
  return allocate(total, Array<number>(n).fill(1));
}

/** Reparto por porcentajes en puntos básicos (deben sumar 10000). */
export function splitByBasisPoints(total: Cents, bps: readonly BasisPoints[]): Cents[] {
  if (!sumsToHundredPercent(bps)) throw new RangeError("Los porcentajes deben sumar 100 %");
  return allocate(total, bps);
}

export function sumsToHundredPercent(bps: readonly BasisPoints[]): boolean {
  return (
    bps.length > 0 &&
    bps.every((b) => Number.isInteger(b) && b >= 0 && b <= BP_TOTAL) &&
    bps.reduce((a, b) => a + b, 0) === BP_TOTAL
  );
}

/** Porcentaje (puntos básicos) de `part` sobre `whole`, redondeado al más cercano. */
export function toBasisPoints(part: Cents, whole: Cents): BasisPoints {
  if (whole === 0) return 0;
  return Math.round((part * BP_TOTAL) / whole);
}

/** Aplica un porcentaje en puntos básicos a un importe, redondeando al céntimo más cercano. */
export function applyBasisPoints(amount: Cents, bp: BasisPoints): Cents {
  return Math.round((amount * bp) / BP_TOTAL);
}
