/** Qué pasa con los saldos de las demás cuentas si se borra una con sus traspasos. */
export type TransferRow = { userId: string; from: string; to: string; amountCents: number; toAmountCents: number | null; date: string };
export type OtherAccount = { id: string; name: string; currency: string; openingDate: string };
export type DeleteImpact = {
  /** Cambio del saldo de cada cuenta que la persona puede ver (en la moneda de esa cuenta) */
  changes: { name: string; currency: string; deltaCents: number }[];
  /** Hay traspasos con cuentas de otras personas que no se ven: cambian, pero sin nombre ni importe */
  hidden: boolean;
  /** Se borran también traspasos que apuntó otra persona */
  othersTransfers: boolean;
};

export function deleteImpact(accountId: string, userId: string, transfers: TransferRow[], others: OtherAccount[]): DeleteImpact {
  const seen = new Map(others.map((a) => [a.id, a]));
  const delta = new Map<string, number>();
  let hidden = false;
  for (const t of transfers) {
    const outgoing = t.from === accountId; // sale de la cuenta que se borra
    const otherId = outgoing ? t.to : t.from;
    const other = seen.get(otherId);
    if (!other) { hidden = true; continue; }
    if (t.date < other.openingDate) continue; // anterior al saldo inicial: no contaba
    // Si se quita lo que recibió, baja; si se quita lo que envió, vuelve
    delta.set(otherId, (delta.get(otherId) ?? 0) + (outgoing ? -(t.toAmountCents ?? t.amountCents) : t.amountCents));
  }
  return {
    changes: [...delta].filter(([, d]) => d !== 0).map(([id, d]) => ({ name: seen.get(id)!.name, currency: seen.get(id)!.currency, deltaCents: d })).sort((a, b) => a.name.localeCompare(b.name)),
    hidden,
    othersTransfers: transfers.some((t) => t.userId !== userId),
  };
}

/** Texto del aviso a los demás miembros al vaciar un espacio (sin importes). */
export const clearedBody = (accountsDeleted: number) =>
  accountsDeleted > 0 ? "Se han borrado los datos de este espacio, y también cuentas de quien lo ha vaciado." : "Se han borrado los datos de este espacio.";
