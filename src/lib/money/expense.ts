import { allocate } from "./allocate";
import { BP_TOTAL, type BasisPoints, type Cents } from "./types";

export type SplitMode = "default" | "equal" | "custom";

export type Participant = { memberId: string; defaultBp: BasisPoints | null };
export type CustomSplit = { kind: "percent" | "amount"; values: Record<string, number> };
export type SplitLine = { memberId: string; shareBp: BasisPoints; amountCents: Cents };
export type PayerLine = { memberId: string; amountCents: Cents };

/**
 * Calcula el reparto de un gasto entre los participantes incluidos (los excluidos simplemente no se pasan).
 * - default: usa el % por defecto del espacio (renormalizado entre los incluidos).
 * - equal: partes iguales.
 * - custom: % (puntos básicos, deben sumar 10000) o importes (deben sumar el total).
 * Las sumas de céntimos y de bp son exactas.
 */
export function buildSplits(total: Cents, mode: SplitMode, participants: readonly Participant[], custom?: CustomSplit): SplitLine[] {
  if (participants.length === 0) throw new RangeError("Hace falta al menos un participante");
  const ids = participants.map((p) => p.memberId);
  if (new Set(ids).size !== ids.length) throw new RangeError("Participantes repetidos");

  let weights: number[];
  if (mode === "equal") {
    weights = ids.map(() => 1);
  } else if (mode === "default") {
    const w = participants.map((p) => p.defaultBp ?? 0);
    weights = w.reduce((a, b) => a + b, 0) > 0 ? w : ids.map(() => 1);
  } else {
    if (!custom) throw new RangeError("Falta el reparto personalizado");
    weights = ids.map((id) => {
      const v = custom.values[id];
      if (v === undefined || !Number.isSafeInteger(v) || v < 0) throw new RangeError("Reparto personalizado no válido");
      return v;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    if (custom.kind === "percent" && sum !== BP_TOTAL) throw new RangeError("Los porcentajes deben sumar 100 %");
    if (custom.kind === "amount" && sum !== total) throw new RangeError("Los importes deben sumar el total");
  }
  const amounts = mode === "custom" && custom?.kind === "amount" ? weights : allocate(total, weights);
  const bps = allocate(BP_TOTAL, weights);
  return ids.map((memberId, i) => ({ memberId, shareBp: bps[i]!, amountCents: amounts[i]! }));
}

/** Pagadores: uno solo paga todo; varios deben sumar el total. */
export function buildPayers(total: Cents, payers: readonly { memberId: string; amountCents?: Cents }[]): PayerLine[] {
  if (payers.length === 0) throw new RangeError("Hace falta un pagador");
  const ids = payers.map((p) => p.memberId);
  if (new Set(ids).size !== ids.length) throw new RangeError("Pagadores repetidos");
  if (payers.length === 1) return [{ memberId: payers[0]!.memberId, amountCents: total }];
  const lines = payers.map((p) => {
    if (p.amountCents === undefined || !Number.isSafeInteger(p.amountCents) || p.amountCents <= 0) throw new RangeError("Importe de pagador no válido");
    return { memberId: p.memberId, amountCents: p.amountCents };
  });
  if (lines.reduce((a, b) => a + b.amountCents, 0) !== total) throw new RangeError("Los pagos no suman el importe");
  return lines;
}

/** "Tu parte" calculada en directo; 0 si no participas. */
export function yourShare(splits: readonly SplitLine[], memberId: string): Cents {
  return splits.find((s) => s.memberId === memberId)?.amountCents ?? 0;
}

/** Importe en moneda base a partir del importe original y el tipo de cambio aplicado. */
export function toBase(amount: Cents, fxRate: number): Cents {
  return Math.round(amount * fxRate);
}
