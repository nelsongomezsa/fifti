import type { Metadata } from "next";
import Link from "next/link";
import { IncomeFields } from "@/components/income/IncomeFields";
import { RepeatingIncomes } from "@/components/income/RepeatingIncomes";
import { ActionForm } from "@/components/ui/ActionForm";
import { DetailDelete } from "@/components/ui/DetailDelete";
import { SwipeHint } from "@/components/ui/SwipeHint";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { formatMoney, addMonths } from "@/lib/money";
import { paydaysText } from "@/lib/paydays-text";
import { loadAccounts } from "@/server/accounts";
import { deleteItem } from "@/server/actions/delete";
import { saveIncome } from "@/server/actions/expenses";
import { incomeConfirms } from "@/server/income-goals";
import { loadIncomeRules } from "@/server/income-rules";
import { detailContext } from "@/server/inicio-detail";
import { loadPlan } from "@/server/plan";

export const metadata: Metadata = { title: "Ingresos" };

export default async function IncomeDetailPage() {
  const { x, user, active, supabase, month, monthName, today } = await detailContext();
  const [plan, incomeResult, { rules, skips }, allAccounts] = await Promise.all([
    loadPlan(supabase, active.id, month),
    supabase.from("incomes").select("id, member_id, amount_cents, source, received_at, account_id, original_amount_cents, original_currency, rule_id")
      .eq("space_id", active.id).gte("received_at", month).lt("received_at", addMonths(month, 1))
      .order("received_at", { ascending: false }),
    loadIncomeRules(supabase, active.id),
    user.is_anonymous ? Promise.resolve([]) : loadAccounts(supabase, user.id),
  ]);
  const me = plan.members.find((member) => member.user_id === user.id);
  const entries = incomeResult.data ?? [];
  const mine = plan.members.filter((member) => member.user_id === user.id || (!member.user_id && me?.role === "owner"));
  const options = mine.map((m) => ({ id: m.id, name: m.user_id === user.id ? x("Yo") : m.display_name }));
  const accounts = allAccounts.filter((a) => a.spaceId === active.id);
  const usable = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const defaultAccount = accounts.find((a) => a.mine && a.isDefault);
  const money = (cents: number, currency = active.currency) => formatMoney(cents, currency, x.locale);
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const ask = await incomeConfirms(supabase, x, entries.map((e) => e.id));

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/inicio" className="flex min-h-11 items-center text-sm text-ink-2">‹ {x("Inicio")}</Link>
      <div>
        <h1 className="text-2xl font-bold">{x("Ingresos de {mes}").replace("{mes}", monthName)}</h1>
        <p className="money mt-2 font-mono text-4xl font-semibold">{money(plan.income)}</p>
        {plan.paydays && <p className="money mt-1 text-sm text-ink-2">{paydaysText(x, plan.paydays)}</p>}
      </div>

      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="font-semibold">{x("Previsto y recibido por persona")}</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {plan.members.map((member) => (
            <li key={member.id} className="flex min-w-0 justify-between gap-3 text-sm">
              <span className="truncate">{member.user_id === user.id ? x("Yo") : member.display_name}</span>
              <span className="shrink-0 text-right text-ink-2">{x("Previsto")} <span className="money font-mono">{money(plan.expected[member.id] ?? 0)}</span><br />
                {x("Recibido")} <span className="money font-mono">{money(plan.actual[member.id] ?? 0)}</span></span>
            </li>
          ))}
        </ul>
      </section>

      {me?.role === "guest" ? (
        <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{x("Los invitados no registran ingresos.")}</p>
      ) : (
        <>
          {(entries.length > 0 || rules.length > 0) && <SwipeHint />}
          <section>
            <h2 className="mb-3 text-lg font-semibold">{x("Ingresos del mes")}</h2>
            {entries.length === 0 ? <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-2">{x("Aún no hay ingresos este mes.")}</p> : (
              <ul className="flex flex-col gap-3">
                {entries.map((entry) => {
                  const member = plan.members.find((item) => item.id === entry.member_id);
                  const editable = mine.some((m) => m.id === entry.member_id);
                  const entered = entry.original_amount_cents ?? entry.amount_cents;
                  const enteredCurrency = entry.original_currency ?? active.currency;
                  const card = <div className="rounded-card border border-border bg-surface p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate font-medium">{entry.source || x("Sin origen")}</p>
                        <p className="text-xs text-ink-3">{member?.user_id === user.id ? x("Yo") : member?.display_name} · {dayLabel(entry.received_at)}{entry.rule_id ? ` · ${x("se repite")}` : ""}</p></div>
                      <span className="shrink-0 text-right"><span className="money block font-mono">{money(entered, enteredCurrency)}</span>
                        {entry.original_currency && <span className="money block font-mono text-xs text-ink-3">≈ {money(entry.amount_cents)}</span>}</span>
                    </div>
                    {editable && <details className="mt-2">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-2">{x("Editar")}</summary>
                      <ActionForm action={saveIncome} optimistic submit={x("Guardar ingreso")} className="flex flex-col gap-3 pt-2">
                        <input type="hidden" name="spaceId" value={active.id} />
                        <input type="hidden" name="id" value={entry.id} />
                        <IncomeFields kind={entry.rule_id ? "payment" : "edit"} members={options} accounts={usable}
                          initial={{ amount: (entered / 100).toFixed(2).replace(".", ","), currency: enteredCurrency, source: entry.source ?? "", date: entry.received_at, frequency: "once", day: Number(entry.received_at.slice(8)), accountId: entry.account_id, memberId: entry.member_id }} />
                      </ActionForm>
                      <div className="mt-3">
                        <DetailDelete label={x("Borrar ingreso")} title={x("¿Borrar este ingreso?")}
                          description={ask.get(entry.id)?.description ?? x("Se quita de tus cuentas. Esta acción no se puede deshacer.")} action={deleteItem.bind(null, { kind: "income", id: entry.id })} />
                      </div>
                    </details>}
                  </div>;
                  return <li key={entry.id}>
                    <SwipeRow id={entry.id} name={entry.source || x("Sin origen")} kind={editable ? "income" : undefined} confirm={ask.get(entry.id)}
                      secondary={editable ? { label: x("Editar"), expand: true } : undefined}>{card}</SwipeRow>
                  </li>;
                })}
              </ul>
            )}
          </section>
          <RepeatingIncomes x={x} spaceId={active.id} rules={rules} skips={skips} members={options} accounts={usable} editable={new Set(mine.map((m) => m.id))} />
          <section className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-lg font-semibold">{x("Añadir ingreso")}</h2>
            <ActionForm action={saveIncome} optimistic submit={x("Guardar ingreso")}>
              <input type="hidden" name="spaceId" value={active.id} />
              <IncomeFields members={options} accounts={usable}
                initial={{ amount: "", currency: defaultAccount?.currency ?? active.currency, source: x("Nómina"), date: today, frequency: "once", day: Number(today.slice(8)), accountId: defaultAccount?.id ?? null, memberId: me?.id ?? options[0]?.id ?? "" }} />
            </ActionForm>
          </section>
        </>
      )}
    </section>
  );
}
