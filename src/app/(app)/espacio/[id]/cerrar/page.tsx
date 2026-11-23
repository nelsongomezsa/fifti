import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { SummaryImage } from "@/components/ui/SummaryImage";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { recordSettlement } from "@/server/actions/balance";
import { closeGroup, reopenGroup } from "@/server/actions/spaces";
import { loadSpaceBalance } from "@/server/balance";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Cerrar plan" };

export default async function ClosePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();
  const { data: space } = await supabase.from("spaces").select("id, name, kind, archived_at, base_currency").eq("id", id).maybeSingle();
  if (!space || space.kind !== "group") notFound();
  const b = await loadSpaceBalance(supabase, id);
  const me = b.members.find((m) => m.user_id === user.id);
  const name = (mid: string) => b.members.find((m) => m.id === mid)?.display_name ?? "—";
  const { data: totals } = await supabase.from("expenses").select("amount_base_cents").eq("space_id", id).eq("paid_from", "member").limit(5000);
  const total = (totals ?? []).reduce((a, e) => a + e.amount_base_cents, 0);
  const fmt = (c: number) => formatMoney(c, space.base_currency);
  const lines = b.transfers.map((t) => ({ text: `${name(t.from)} → ${name(t.to)}`, amount: fmt(t.amountCents) }));

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href={`/espacio/${id}`} className="text-sm text-ink-2">‹ {space.name}</Link>
      <h1 className="text-2xl font-bold">{space.archived_at ? "Plan cerrado" : "Cerrar plan"}: {space.name}</h1>
      <p className="money font-mono text-3xl">{fmt(total)}</p>
      <h2 className="text-lg font-semibold">Quién paga a quién</h2>
      {b.transfers.length === 0 ? <p className="text-ink-2">Todo está saldado.</p> : (
        <ul className="flex flex-col gap-2">
          {b.transfers.map((t) => (
            <li key={`${t.from}-${t.to}`} className="rounded-card border border-border bg-surface p-4">
              <p className="flex justify-between"><span>{name(t.from)} → {name(t.to)}</span><span className="money font-mono">{fmt(t.amountCents)}</span></p>
              {(me?.id === t.from || me?.id === t.to || me?.role === "owner") && (
                <ActionForm action={recordSettlement} submit="Marcar como pagado" tone="plain" className="mt-3 flex gap-2">
                  <input type="hidden" name="spaceId" value={id} /><input type="hidden" name="from" value={t.from} /><input type="hidden" name="to" value={t.to} />
                  <input type="hidden" name="amount" value={(t.amountCents / 100).toFixed(2).replace(".", ",")} />
                  <select name="method" aria-label="Método" className={inputClass}><option value="bizum">Bizum</option><option value="transfer">Transferencia</option><option value="cash">Efectivo</option><option value="other">Otro</option></select>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
      <SummaryImage title={space.name} total={fmt(total)} lines={lines} />
      {me?.role === "owner" && (space.archived_at ? (
        <form action={reopenGroup}><input type="hidden" name="spaceId" value={id} /><button className="min-h-11 w-full rounded-full border border-border font-semibold">Reabrir el plan</button></form>
      ) : (
        <ActionForm action={closeGroup} submit="Cerrar y archivar el plan">
          <input type="hidden" name="spaceId" value={id} />
          <p className="text-sm text-ink-3">Se crea un enlace de resumen de solo lectura (30 días) y el plan se archiva: no se podrán añadir más gastos.</p>
        </ActionForm>
      ))}
    </section>
  );
}
