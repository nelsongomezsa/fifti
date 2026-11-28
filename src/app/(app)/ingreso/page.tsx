import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { IncomeFields } from "@/components/income/IncomeFields";
import { ActionForm } from "@/components/ui/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { incomeConfirms } from "@/server/income-goals";
import { saveIncome } from "@/server/actions/expenses";
import { loadAccounts } from "@/server/accounts";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Ingresos" };

export default async function IncomePage() {
  const x = await getTx();
  const user = await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active) return null;
  const supabase = await createClient();
  const { data: members } = await supabase.from("space_members").select("id, user_id, display_name, role").eq("space_id", active.id);
  const me = members?.find((m) => m.user_id === user.id);
  const mine = members?.filter((m) => m.user_id === user.id || (!m.user_id && me?.role === "owner")) ?? [];
  const spaceAccounts = user.is_anonymous ? [] : (await loadAccounts(supabase, user.id)).filter((a) => a.spaceId === active.id);
  const { data: incomes } = await supabase.from("incomes").select("id, member_id, amount_cents, source, received_at").eq("space_id", active.id).order("received_at", { ascending: false }).limit(30);
  const today = new Date().toISOString().slice(0, 10);
  const ask = await incomeConfirms(supabase, x, (incomes ?? []).map((i) => i.id));
  const defaultAccount = spaceAccounts.find((a) => a.mine && a.isDefault);

  if (me?.role === "guest") return <p className="pt-4 text-ink-2">{x("Los invitados no registran ingresos.")}</p>;
  return (
    <section className="flex flex-col gap-5 pt-2">
      <h1 className="text-2xl font-bold">{x("Ingresos")}</h1>
      <ActionForm action={saveIncome} optimistic submit={x("Guardar ingreso")}>
        <input type="hidden" name="spaceId" value={active.id} />
        <IncomeFields
          members={mine.map((m) => ({ id: m.id, name: m.user_id === user.id ? x("Yo") : m.display_name }))}
          accounts={spaceAccounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          initial={{ amount: "", currency: defaultAccount?.currency ?? active.currency, source: x("Nómina"), date: today, frequency: "once", day: Number(today.slice(8)), accountId: defaultAccount?.id ?? null, memberId: me?.id ?? mine[0]?.id ?? "" }} />
      </ActionForm>
      <Link href="/inicio/ingresos" className="flex min-h-11 items-center self-start text-sm text-ink-2">{x("Ingresos que se repiten")} ›</Link>
      <ul className="flex flex-col gap-2">
        {incomes?.map((i) => (
          <li key={i.id}>
            <SwipeRow id={i.id} name={i.source} kind={mine.some((m) => m.id === i.member_id) ? "income" : undefined} confirm={ask.get(i.id)}>
              <div className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 text-sm">
                <span>{i.source}<span className="block text-xs text-ink-3">{members?.find((m) => m.id === i.member_id)?.display_name} · {new Date(`${i.received_at}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</span></span>
                <span className="money font-mono">{formatMoney(i.amount_cents, active.currency, x.locale)}</span>
              </div>
            </SwipeRow>
          </li>
        ))}
      </ul>
    </section>
  );
}
