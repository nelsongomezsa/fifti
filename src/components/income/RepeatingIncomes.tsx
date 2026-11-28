import { IncomeFields } from "@/components/income/IncomeFields";
import { SkipPayday } from "@/components/income/SkipPayday";
import { ActionForm } from "@/components/ui/ActionForm";
import { SwipeRow } from "@/components/ui/SwipeRow";
import type { Tx } from "@/i18n/tx";
import { formatMoney } from "@/lib/money";
import { PAY_FREQUENCIES, type IncomeRule } from "@/lib/paydays";
import { saveIncome } from "@/server/actions/expenses";
import { setIncomeRuleActive } from "@/server/actions/income-rules";

/** Las series de ingresos: deslizar para borrar (los cobros apuntados se quedan) o pausar, saltar el próximo y editar. */
export function RepeatingIncomes({ x, spaceId, rules, skips, members, accounts, editable }: {
  x: Tx; spaceId: string; rules: IncomeRule[]; skips: ReadonlySet<string>;
  members: { id: string; name: string }[]; accounts: { id: string; name: string; currency: string }[]; editable: ReadonlySet<string>;
}) {
  if (rules.length === 0) return null;
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(x.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{x("Ingresos que se repiten")}</h2>
      <ul className="flex flex-col gap-3">
        {rules.map((r) => {
          const mine = editable.has(r.memberId);
          const skipped = skips.has(`${r.id}|${r.nextRun}`);
          const every = PAY_FREQUENCIES.find((f) => f.id === r.frequency)!.label;
          return (
            <li key={r.id}>
              <SwipeRow id={r.id} name={r.source} kind={mine ? "income_rule" : undefined}
                secondary={mine ? { label: r.active ? x("Pausar") : x("Reanudar"), run: setIncomeRuleActive.bind(null, { id: r.id, active: !r.active }) } : undefined}>
                <div className="rounded-card border border-border bg-surface p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.source}</p>
                      <p className="text-xs text-ink-3">{x(every)} · {r.active ? `${x("Próximo cobro")}: ${day(r.nextRun)}${skipped ? ` (${x("saltado")})` : ""}` : x("En pausa")}</p>
                    </div>
                    <span className="money shrink-0 font-mono">{formatMoney(r.amountCents, r.currency, x.locale)}</span>
                  </div>
                  {mine && (
                    <>
                      {r.active && <div className="mt-3 flex flex-wrap gap-2"><SkipPayday ruleId={r.id} date={r.nextRun} skipped={skipped} /></div>}
                      <details className="mt-2">
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-2">{x("Editar la serie")}</summary>
                        <ActionForm action={saveIncome} optimistic submit={x("Guardar serie")} className="flex flex-col gap-3 pt-2">
                          <input type="hidden" name="spaceId" value={spaceId} />
                          <input type="hidden" name="ruleId" value={r.id} />
                          <IncomeFields kind="rule" members={members} accounts={accounts}
                            initial={{ amount: (r.amountCents / 100).toFixed(2).replace(".", ","), currency: r.currency, source: r.source, date: r.nextRun, frequency: r.frequency, day: r.day, day2: r.day2, accountId: r.accountId, memberId: r.memberId }} />
                        </ActionForm>
                      </details>
                    </>
                  )}
                </div>
              </SwipeRow>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
