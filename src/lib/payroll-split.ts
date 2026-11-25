export type SplitFund = { plannedCents: number; accountId: string | null };
export type SplitDone = { toAccount: string; amountCents: number };
export type SplitSuggestion = { toAccountId: string; amountCents: number };

/**
 * «Reparte tu nómina»: de lo previsto en cada partida con cuenta asociada, lo que hay que pasar desde la cuenta donde cobras
 * a cada cuenta destino, descontando los traspasos de reparto ya hechos este mes. Solo cantidades enteras en céntimos.
 */
export function payrollSplit(funds: SplitFund[], payrollAccountId: string | null, done: SplitDone[]): SplitSuggestion[] {
  if (!payrollAccountId) return [];
  const want = new Map<string, number>();
  for (const f of funds) {
    if (!f.accountId || f.accountId === payrollAccountId || f.plannedCents <= 0) continue;
    want.set(f.accountId, (want.get(f.accountId) ?? 0) + f.plannedCents);
  }
  const made = new Map<string, number>();
  for (const d of done) made.set(d.toAccount, (made.get(d.toAccount) ?? 0) + d.amountCents);
  const out: SplitSuggestion[] = [];
  for (const [toAccountId, cents] of want) {
    const left = cents - (made.get(toAccountId) ?? 0);
    if (left > 0) out.push({ toAccountId, amountCents: left });
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}

/** Cuenta de origen del reparto: la del ingreso de nómina, o si no la cuenta de tipo nómina, o la de por defecto. */
export function payrollSource(incomeAccountId: string | null, accounts: { id: string; kind: string; isDefault: boolean; mine: boolean }[]): string | null {
  const mine = accounts.filter((a) => a.mine);
  return incomeAccountId && mine.some((a) => a.id === incomeAccountId) ? incomeAccountId : mine.find((a) => a.kind === "payroll")?.id ?? mine.find((a) => a.isDefault)?.id ?? null;
}
