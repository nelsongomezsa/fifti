import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { DetailDelete } from "@/components/ui/DetailDelete";
import { SwipeHint } from "@/components/ui/SwipeHint";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { formatMoney, addMonths } from "@/lib/money";
import { deleteItem } from "@/server/actions/delete";
import { saveIncome } from "@/server/actions/expenses";
import { incomeConfirms } from "@/server/income-goals";
import { detailContext } from "@/server/inicio-detail";
import { loadPlan } from "@/server/plan";

export const metadata: Metadata = { title: "Ingresos" };

export default async function IncomeDetailPage() {
  const { x, user, active, supabase, month, monthName, today } = await detailContext();
  const [plan, incomeResult] = await Promise.all([
    loadPlan(supabase, active.id, month),
    supabase.from("incomes").select("id, member_id, amount_cents, source, received_at, is_recurring")
      .eq("space_id", active.id).gte("received_at", month).lt("received_at", addMonths(month, 1))
      .order("received_at", { ascending: false }),
  ]);
  const me = plan.members.find((member) => member.user_id === user.id);
  const actualTotal = Object.values(plan.actual).reduce((sum, amount) => sum + amount, 0);
  const expectedTotal = Object.values(plan.expected).reduce((sum, amount) => sum + amount, 0);
  const total = actualTotal > 0 ? actualTotal : expectedTotal;
  const entries = incomeResult.data ?? [];
  const mine = plan.members.filter((member) => member.user_id === user.id || (!member.user_id && me?.role === "owner"));
  const money = (cents: number) => formatMoney(cents, active.currency, x.locale);
  const ask = await incomeConfirms(supabase, x, entries.map((e) => e.id));

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/inicio" className="flex min-h-11 items-center text-sm text-ink-2">‹ {x("Inicio")}</Link>
      <div>
        <h1 className="text-2xl font-bold">{x("Ingresos de {mes}").replace("{mes}", monthName)}</h1>
        <p className="money mt-2 font-mono text-4xl font-semibold">{money(total)}</p>
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
          <section>
            <h2 className="mb-3 text-lg font-semibold">{x("Ingresos del mes")}</h2>
            {entries.length > 0 && <div className="mb-3"><SwipeHint /></div>}
            {entries.length === 0 ?<p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-2">{x("Aún no hay ingresos este mes.")}</p> : (
              <ul className="flex flex-col gap-3">
                {entries.map((entry) => {
                  const member = plan.members.find((item) => item.id === entry.member_id);
                  const editable = mine.some((m) => m.id === entry.member_id);
                  const card = <div className="rounded-card border border-border bg-surface p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate font-medium">{entry.source || x("Sin origen")}</p>
                        <p className="text-xs text-ink-3">{member?.user_id === user.id ? x("Yo") : member?.display_name} · {entry.received_at}</p></div>
                      <span className="money shrink-0 font-mono">{money(entry.amount_cents)}</span>
                    </div>
                    {editable && <details className="mt-2">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-2">{x("Editar")}</summary>
                      <ActionForm action={saveIncome} optimistic submit={x("Guardar ingreso")} className="flex flex-col gap-3 pt-2">
                        <input type="hidden" name="spaceId" value={active.id} />
                        <input type="hidden" name="id" value={entry.id} />
                        <select name="memberId" aria-label={x("Persona")} className={inputClass} defaultValue={entry.member_id}>
                          {mine.map((item) => <option key={item.id} value={item.id}>{item.user_id === user.id ? x("Yo") : item.display_name}</option>)}
                        </select>
                        <input name="amount" inputMode="decimal" required defaultValue={(entry.amount_cents / 100).toFixed(2)} aria-label={x("Importe")} className={`${inputClass} font-mono`} />
                        <input name="source" defaultValue={entry.source ?? ""} maxLength={60} aria-label={x("Origen")} className={inputClass} />
                        <input name="receivedAt" type="date" defaultValue={entry.received_at} required aria-label={x("Fecha")} className={inputClass} />
                        <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2"><input type="checkbox" name="isRecurring" defaultChecked={entry.is_recurring} /> {x("Se repite cada mes")}</label>
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
          <section className="rounded-card border border-border bg-surface p-4">
            <h2 className="mb-3 text-lg font-semibold">{x("Añadir ingreso")}</h2>
            <ActionForm action={saveIncome} optimistic submit={x("Guardar ingreso")}>
              <input type="hidden" name="spaceId" value={active.id} />
              <select name="memberId" aria-label={x("Persona")} className={inputClass} defaultValue={me?.id}>
                {mine.map((member) => <option key={member.id} value={member.id}>{member.user_id === user.id ? x("Yo") : member.display_name}</option>)}
              </select>
              <input name="amount" inputMode="decimal" required placeholder={x("Importe (1.800,00)")} aria-label={x("Importe")} className={`${inputClass} font-mono`} />
              <input name="source" defaultValue={x("Nómina")} maxLength={60} aria-label={x("Origen")} className={inputClass} />
              <input name="receivedAt" type="date" defaultValue={today} required aria-label={x("Fecha")} className={inputClass} />
              <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2"><input type="checkbox" name="isRecurring" /> {x("Se repite cada mes")}</label>
            </ActionForm>
          </section>
        </>
      )}
    </section>
  );
}
