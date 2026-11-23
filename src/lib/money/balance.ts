import type { Cents } from "./types";

export type BalanceExpense = {
  paidFrom: "member" | "pot";
  payers: { memberId: string; amountCents: Cents }[];
  splits: { memberId: string; amountCents: Cents }[];
};
export type BalanceSettlement = { fromMemberId: string; toMemberId: string; amountCents: Cents };
export type Transfer = { from: string; to: string; amountCents: Cents };

/**
 * Saldo de cada miembro = lo que pagó − lo que le toca ± liquidaciones.
 * Positivo = le deben; negativo = debe. Los gastos pagados desde el bote no crean deudas entre personas.
 * La suma de todos los saldos es siempre 0.
 */
export function computeBalances(
  memberIds: readonly string[],
  expenses: readonly BalanceExpense[],
  settlements: readonly BalanceSettlement[] = [],
): Record<string, Cents> {
  const bal: Record<string, Cents> = Object.fromEntries(memberIds.map((id) => [id, 0]));
  const add = (id: string, v: Cents) => {
    if (!(id in bal)) throw new RangeError("Miembro desconocido en un movimiento");
    bal[id] = bal[id]! + v;
  };
  for (const e of expenses) {
    if (e.paidFrom === "pot") continue;
    for (const p of e.payers) add(p.memberId, p.amountCents);
    for (const s of e.splits) add(s.memberId, -s.amountCents);
  }
  // Quien paga una deuda sube su saldo (debe menos); quien cobra lo baja.
  for (const s of settlements) {
    add(s.fromMemberId, s.amountCents);
    add(s.toMemberId, -s.amountCents);
  }
  return bal;
}

/**
 * Simplifica las deudas con pocos pagos: empareja siempre al mayor deudor con el mayor acreedor.
 * Genera como máximo (personas con saldo ≠ 0) − 1 pagos y deja a todos a cero. Orden determinista.
 */
export function simplifyDebts(balances: Readonly<Record<string, Cents>>): Transfer[] {
  const creditors = Object.entries(balances).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  const debtors = Object.entries(balances).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!, c = creditors[j]!;
    const amt = Math.min(d.v, c.v);
    if (amt > 0) out.push({ from: d.id, to: c.id, amountCents: amt });
    d.v -= amt; c.v -= amt;
    if (d.v === 0) i++;
    if (c.v === 0) j++;
    // re-ordenar para emparejar siempre extremos (mantiene el nº de pagos bajo)
    debtors.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
    creditors.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
    i = debtors.findIndex((x) => x.v > 0); if (i < 0) i = debtors.length;
    j = creditors.findIndex((x) => x.v > 0); if (j < 0) j = creditors.length;
  }
  return out;
}

/** "¿Quién paga ahora?": quien más debe (saldo más negativo). Empate: orden por id. null si todos están a cero. */
export function whoPaysNext(balances: Readonly<Record<string, Cents>>): string | null {
  const sorted = Object.entries(balances).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const first = sorted[0];
  return first && first[1] < 0 ? first[0] : null;
}

/** Modo "a cero": los pagos exactos que dejan a todos a cero con los saldos actuales. */
export const zeroOutPayments = simplifyDebts;

/** Concepto listo para copiar en un Bizum o transferencia. */
export function paymentConcept(spaceName: string, fromName: string): string {
  return `Fifti ${spaceName} - ${fromName}`.slice(0, 60);
}

// ───────── Compensación entre grupos ─────────
export type PairDebt = { spaceId: string; from: string; to: string; amountCents: Cents };
export type OffsetLine = { spaceId: string; fromMemberId: string; toMemberId: string; amountCents: Cents };

/**
 * Dadas las deudas directas entre dos personas (A y B) en cada grupo compartido, propone compensar
 * min(lo que A debe a B, lo que B debe a A). Devuelve las liquidaciones por grupo que dejan un solo pago neto.
 * `debts[i].from/to` son user ids; `memberOf` traduce (spaceId, userId) → memberId.
 * Ejemplo: Leo debe 30 en "Lisboa" y A debe 20 en "Hogar" → compensa 20 y queda que Leo pague 10.
 */
export function proposeOffset(
  userA: string,
  userB: string,
  debts: readonly PairDebt[],
  memberOf: (spaceId: string, userId: string) => string | undefined,
): { amountCents: Cents; lines: OffsetLine[]; remaining: { from: string; to: string; amountCents: Cents } | null } | null {
  const ab = debts.filter((d) => d.from === userA && d.to === userB);
  const ba = debts.filter((d) => d.from === userB && d.to === userA);
  const sumAB = ab.reduce((s, d) => s + d.amountCents, 0);
  const sumBA = ba.reduce((s, d) => s + d.amountCents, 0);
  const amount = Math.min(sumAB, sumBA);
  if (amount <= 0) return null;

  const lines: OffsetLine[] = [];
  const take = (list: readonly PairDebt[]) => {
    let left = amount;
    for (const d of list) {
      if (left <= 0) break;
      const x = Math.min(d.amountCents, left);
      const from = memberOf(d.spaceId, d.from), to = memberOf(d.spaceId, d.to);
      if (!from || !to) throw new RangeError("Miembro no encontrado en el grupo");
      lines.push({ spaceId: d.spaceId, fromMemberId: from, toMemberId: to, amountCents: x });
      left -= x;
    }
  };
  take(ab);
  take(ba);
  const diff = sumAB - sumBA;
  return { amountCents: amount, lines, remaining: diff === 0 ? null : diff > 0 ? { from: userA, to: userB, amountCents: diff } : { from: userB, to: userA, amountCents: -diff } };
}
