import type { Metadata } from "next";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/money";
import { deleteIncome, saveIncome } from "@/server/actions/expenses";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Ingresos" };

export default async function IncomePage() {
  const user = await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active) return null;
  const supabase = await createClient();
  const { data: members } = await supabase.from("space_members").select("id, user_id, display_name, role").eq("space_id", active.id);
  const me = members?.find((m) => m.user_id === user.id);
  const mine = members?.filter((m) => m.user_id === user.id || (!m.user_id && me?.role === "owner")) ?? [];
  const { data: incomes } = await supabase.from("incomes").select("id, member_id, amount_cents, source, received_at").eq("space_id", active.id).order("received_at", { ascending: false }).limit(30);
  const today = new Date().toISOString().slice(0, 10);

  if (me?.role === "guest") return <p className="pt-4 text-ink-2">Los invitados no registran ingresos.</p>;
  return (
    <section className="flex flex-col gap-5 pt-2">
      <h1 className="text-2xl font-bold">Ingresos</h1>
      <ActionForm action={saveIncome} submit="Guardar ingreso">
        <input type="hidden" name="spaceId" value={active.id} />
        <select name="memberId" aria-label="Persona" className={inputClass} defaultValue={me?.id}>
          {mine.map((m) => <option key={m.id} value={m.id}>{m.user_id === user.id ? "Yo" : m.display_name}</option>)}
        </select>
        <input name="amount" inputMode="decimal" required placeholder="Importe (1.800,00)" aria-label="Importe" className={`${inputClass} font-mono`} />
        <input name="source" defaultValue="Nómina" maxLength={60} aria-label="Origen" className={inputClass} />
        <input name="receivedAt" type="date" defaultValue={today} required aria-label="Fecha" className={inputClass} />
        <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2"><input type="checkbox" name="isRecurring" /> Se repite cada mes</label>
      </ActionForm>
      <ul className="flex flex-col gap-2">
        {incomes?.map((i) => (
          <li key={i.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
            <span>{i.source}<span className="block text-xs text-ink-3">{members?.find((m) => m.id === i.member_id)?.display_name} · {i.received_at}</span></span>
            <span className="flex items-center gap-3">
              <span className="money font-mono">{formatMoney(i.amount_cents)}</span>
              <form action={deleteIncome}><input type="hidden" name="incomeId" value={i.id} /><button aria-label="Borrar ingreso" className="min-h-11 min-w-11 text-over-text">✕</button></form>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
