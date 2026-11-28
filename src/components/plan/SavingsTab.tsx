import { getTx } from "@/i18n/tx";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { NewGoalSheet } from "@/components/savings/NewGoalSheet";
import { SwipeHint } from "@/components/ui/SwipeHint";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { GOAL_DELETE } from "@/lib/delete-kinds";
import { requireUser } from "@/server/spaces";
import { formatMoney, goalProgress } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const KIND = { simple: "Meta", big_event: "Meta grande", challenge: "Reto" } as const;

/** Metas de ahorro: es la pestaña Ahorro del Plan. */
export async function SavingsTab({ active }: { active: { id: string; kind: "personal" | "household" | "group"; currency: string } }) {
  const x = await getTx();
  if (active.kind === "group") {
    return <section className="pt-2"><p className="mt-3 rounded-card border border-border bg-surface p-4 text-ink-2">{x("El ahorro está en tu burbuja personal y en el hogar. Cambia de burbuja arriba.")}</p></section>;
  }
  const supabase = await createClient();
  const { data: goals } = await supabase.from("savings_goals").select("id, name, target_cents, deadline, emoji, kind").eq("space_id", active.id).order("created_at");
  const { data: contribs } = await supabase.from("goal_contributions").select("goal_id, amount_cents").eq("space_id", active.id);
  const { data: miles } = await supabase.from("goal_milestones").select("goal_id, amount_cents, paid").eq("space_id", active.id);
  const user = await requireUser();
  const { data: me } = await supabase.from("space_members").select("role").eq("space_id", active.id).eq("user_id", user.id).maybeSingle();
  const canEdit = !!me && me.role !== "guest";
  const hasMore = (id: string) => (contribs ?? []).some((c) => c.goal_id === id) || (miles ?? []).some((m) => m.goal_id === id);
  const total = (id: string) =>(contribs ?? []).filter((c) => c.goal_id === id).reduce((a, c) => a + c.amount_cents, 0);

  return (
    <section className="flex flex-col gap-5 pt-2">
      {(goals ?? []).length === 0 && (
        <EmptyState title={x("Aún no tienes metas")} text={x("Crea tu primera meta: un viaje, un colchón o el reto de las 52 semanas. Verás cuánto llevas y cuándo llegarás.")}><NewGoalSheet spaceId={active.id} /></EmptyState>
      )}
      {canEdit && (goals ?? []).length > 0 && <SwipeHint />}
      <ul className="flex flex-col gap-3">
        {goals?.map((g) => {
          const p = goalProgress(g.target_cents, total(g.id), (miles ?? []).filter((m) => m.goal_id === g.id).map((m) => ({ amountCents: m.amount_cents, paid: m.paid })));
          return (
            <li key={g.id}>
              <SwipeRow id={g.id} name={g.name} kind={canEdit ? "goal" : undefined}
                confirm={hasMore(g.id) ? { title: x("¿Borrar esta meta?"), description: x(GOAL_DELETE) } : undefined}
                secondary={canEdit ? { label: x("Editar"), href: `/ahorro/${g.id}` } : undefined}>
              <Link href={`/ahorro/${g.id}`} className="block rounded-card border border-border bg-surface p-4">
                <p className="flex items-center justify-between"><span className="font-medium">{g.emoji ? `${g.emoji} ` : ""}{g.name}</span><span className="text-xs text-ink-3">{x(KIND[g.kind as keyof typeof KIND])}</span></p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.round(p.pctBp / 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progreso de ${g.name}`}>
                  <div className="h-full rounded-full" style={{ width: `${p.pctBp / 100}%`, background: p.pctBp >= 10000 ? "var(--lime)" : "var(--lilac)" }} />
                </div>
                <p className="money mt-2 flex justify-between font-mono text-xs text-ink-2"><span>{formatMoney(p.contributed, active.currency, x.locale)} {x("de")}{" "}{formatMoney(g.target_cents, active.currency, x.locale)}</span><span>{Math.round(p.pctBp / 100)} %</span></p>
              </Link>
              </SwipeRow>
            </li>
          );
        })}
      </ul>
      {(goals ?? []).length > 0 && <NewGoalSheet spaceId={active.id} />}
    </section>
  );
}
