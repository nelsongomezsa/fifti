import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { formatMoney, goalProgress } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { createGoal } from "@/server/actions/savings";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Ahorro" };

const KIND = { simple: "Meta", big_event: "Meta grande", challenge: "Reto" } as const;

export default async function SavingsPage() {
  await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active) return null;
  if (active.kind === "group") {
    return <section className="pt-2"><h1 className="text-2xl font-bold">Ahorro</h1><p className="mt-3 rounded-card border border-border bg-surface p-4 text-ink-2">El ahorro está en tu burbuja personal y en el hogar. Cambia de burbuja arriba.</p></section>;
  }
  const supabase = await createClient();
  const { data: goals } = await supabase.from("savings_goals").select("id, name, target_cents, deadline, emoji, kind").eq("space_id", active.id).order("created_at");
  const { data: contribs } = await supabase.from("goal_contributions").select("goal_id, amount_cents").eq("space_id", active.id);
  const { data: miles } = await supabase.from("goal_milestones").select("goal_id, amount_cents, paid").eq("space_id", active.id);
  const total = (id: string) => (contribs ?? []).filter((c) => c.goal_id === id).reduce((a, c) => a + c.amount_cents, 0);

  return (
    <section className="flex flex-col gap-5 pt-2">
      <h1 className="text-2xl font-bold">Ahorro</h1>
      {(goals ?? []).length === 0 && <p className="rounded-card border border-border bg-surface p-4 text-ink-2">Crea tu primera meta: un viaje, un colchón o el reto de las 52 semanas.</p>}
      <ul className="flex flex-col gap-3">
        {goals?.map((g) => {
          const p = goalProgress(g.target_cents, total(g.id), (miles ?? []).filter((m) => m.goal_id === g.id).map((m) => ({ amountCents: m.amount_cents, paid: m.paid })));
          return (
            <li key={g.id}>
              <Link href={`/ahorro/${g.id}`} className="block rounded-card border border-border bg-surface p-4">
                <p className="flex items-center justify-between"><span className="font-medium">{g.emoji ? `${g.emoji} ` : ""}{g.name}</span><span className="text-xs text-ink-3">{KIND[g.kind as keyof typeof KIND]}</span></p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.round(p.pctBp / 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progreso de ${g.name}`}>
                  <div className="h-full rounded-full bg-lilac" style={{ width: `${p.pctBp / 100}%` }} />
                </div>
                <p className="money mt-2 flex justify-between font-mono text-xs text-ink-2"><span>{formatMoney(p.contributed)} de {formatMoney(g.target_cents)}</span><span>{Math.round(p.pctBp / 100)} %</span></p>
              </Link>
            </li>
          );
        })}
      </ul>
      <details className="rounded-card border border-border bg-surface p-4">
        <summary className="min-h-11 cursor-pointer font-semibold">Nueva meta</summary>
        <ActionForm action={createGoal} submit="Crear meta" className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="spaceId" value={active.id} />
          <select name="kind" defaultValue="simple" aria-label="Tipo" className={inputClass}>
            <option value="simple">Meta simple</option><option value="big_event">Meta grande con pagos (boda, piso)</option><option value="challenge">Reto de las 52 semanas</option>
          </select>
          <input name="name" required maxLength={60} placeholder="Viaje Lisboa" aria-label="Nombre" className={inputClass} />
          <input name="target" inputMode="decimal" placeholder="Objetivo (1.500,00). No hace falta en el reto" aria-label="Objetivo" className={`${inputClass} font-mono`} />
          <label className="flex flex-col gap-1 text-xs text-ink-3">Fecha límite (opcional)<input type="date" name="deadline" className={inputClass} /></label>
        </ActionForm>
      </details>
    </section>
  );
}
