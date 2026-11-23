import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { challenge52, formatMoney, goalProgress, monthlyNeeded } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { addContribution, addMilestone, deleteContribution, deleteGoal, deleteRule, saveRule, toggleMilestone } from "@/server/actions/savings";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Meta de ahorro" };

const SOURCE = { manual: "Manual", roundup: "Redondeo", income_rule: "% del ingreso", month_surplus: "Sobrante del mes", challenge: "Reto" } as const;

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();
  const { data: g } = await supabase.from("savings_goals").select("*").eq("id", id).maybeSingle();
  if (!g) notFound();
  const [{ data: contribs }, { data: miles }, { data: rules }, { data: me }] = await Promise.all([
    supabase.from("goal_contributions").select("id, amount_cents, source, contributed_at, member_id").eq("goal_id", id).order("contributed_at", { ascending: false }).limit(100),
    supabase.from("goal_milestones").select("id, name, due_on, amount_cents, paid").eq("goal_id", id).order("due_on", { ascending: true, nullsFirst: false }),
    supabase.from("saving_rules").select("id, kind, value, active").eq("goal_id", id),
    supabase.from("space_members").select("id, role").eq("space_id", g.space_id).eq("user_id", user.id).maybeSingle(),
  ]);
  const canEdit = me && me.role !== "guest";
  const total = (contribs ?? []).reduce((a, c) => a + c.amount_cents, 0);
  const p = goalProgress(g.target_cents, total, (miles ?? []).map((m) => ({ amountCents: m.amount_cents, paid: m.paid })));
  const need = monthlyNeeded(p.remaining, g.deadline, new Date().toISOString().slice(0, 10));
  const step = (rules ?? []).find((r) => r.kind === "weekly_challenge")?.value ?? 100;
  const weeks = challenge52(step);
  const doneWeeks = (contribs ?? []).filter((c) => c.source === "challenge").length;
  const nextWeek = weeks[Math.min(doneWeeks, 51)]!;

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/ahorro" className="text-sm text-ink-2">‹ Ahorro</Link>
      <div>
        <h1 className="text-2xl font-bold">{g.emoji ? `${g.emoji} ` : ""}{g.name}</h1>
        <p className="money mt-1 font-mono text-3xl">{formatMoney(p.contributed)} <span className="text-base text-ink-3">de {formatMoney(g.target_cents)}</span></p>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.round(p.pctBp / 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso">
          <div className="h-full rounded-full bg-lilac" style={{ width: `${p.pctBp / 100}%` }} />
        </div>
        <p className="mt-2 text-sm text-ink-2">Faltan <span className="money font-mono">{formatMoney(p.remaining)}</span>{g.deadline ? ` · hasta el ${g.deadline}` : ""}{need > 0 ? <> · ahorra <span className="money font-mono">{formatMoney(need)}</span> al mes</> : null}</p>
        {g.kind === "big_event" && <p className="money mt-1 font-mono text-sm text-ink-3">Disponible {formatMoney(p.available)} · pagos pendientes {formatMoney(p.unpaidMilestones)}</p>}
      </div>

      {canEdit && (
        <ActionForm action={addContribution} submit="Aportar" className="flex gap-2">
          <input type="hidden" name="goalId" value={id} />
          <input name="amount" required inputMode="decimal" placeholder="50,00" aria-label="Importe" className={`${inputClass} font-mono`} />
        </ActionForm>
      )}

      {g.kind === "challenge" && (
        <div className="rounded-card border border-border bg-surface p-4">
          <h2 className="font-semibold">Reto de las 52 semanas</h2>
          <p className="mt-1 text-sm text-ink-2">Semana {nextWeek.week}: <span className="money font-mono">{formatMoney(nextWeek.amountCents)}</span> · llevas {doneWeeks} de 52</p>
          {canEdit && doneWeeks < 52 && (
            <ActionForm action={addContribution} submit={`Aportar semana ${nextWeek.week}`} className="mt-3 flex">
              <input type="hidden" name="goalId" value={id} /><input type="hidden" name="source" value="challenge" />
              <input type="hidden" name="amount" value={(nextWeek.amountCents / 100).toFixed(2).replace(".", ",")} />
            </ActionForm>
          )}
          <div className="mt-3 grid grid-cols-13 gap-1" aria-hidden style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
            {weeks.map((w) => <span key={w.week} className="h-2 rounded-sm" style={{ background: w.week <= doneWeeks ? "var(--lilac)" : "var(--track)" }} />)}
          </div>
        </div>
      )}

      {g.kind === "big_event" && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Pagos programados</h2>
          {(miles ?? []).length === 0 && <p className="text-sm text-ink-3">Añade los pagos a proveedores con su fecha.</p>}
          <ul className="flex flex-col gap-2">
            {miles?.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
                <span className={m.paid ? "text-ink-3 line-through" : ""}>{m.name}<span className="block text-xs text-ink-3">{m.due_on ?? "sin fecha"}</span></span>
                <span className="flex items-center gap-2">
                  <span className="money font-mono">{formatMoney(m.amount_cents)}</span>
                  {canEdit && <form action={toggleMilestone}><input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="goalId" value={id} /><input type="hidden" name="paid" value={m.paid ? "0" : "1"} />
                    <button className="min-h-11 rounded-full border border-border px-3 text-xs">{m.paid ? "Deshacer" : "Pagado"}</button></form>}
                </span>
              </li>
            ))}
          </ul>
          {canEdit && (
            <ActionForm action={addMilestone} submit="Añadir pago" tone="plain" className="flex flex-col gap-2">
              <input type="hidden" name="goalId" value={id} /><input type="hidden" name="spaceId" value={g.space_id} />
              <input name="name" required maxLength={60} placeholder="Fotógrafo" aria-label="Concepto del pago" className={inputClass} />
              <input name="amount" required inputMode="decimal" placeholder="800,00" aria-label="Importe del pago" className={`${inputClass} font-mono`} />
              <input name="dueOn" type="date" aria-label="Fecha del pago" className={inputClass} />
            </ActionForm>
          )}
        </div>
      )}

      {canEdit && g.kind !== "challenge" && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Reglas automáticas</h2>
          <ul className="flex flex-col gap-2">
            {rules?.filter((r) => r.kind !== "weekly_challenge").map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
                <span>{r.kind === "roundup" ? `Redondeo al siguiente ${formatMoney(r.value)}` : `${(r.value / 100).toFixed(2).replace(".", ",")} % de cada ingreso`}</span>
                <form action={deleteRule}><input type="hidden" name="ruleId" value={r.id} /><input type="hidden" name="goalId" value={id} /><button aria-label="Quitar regla" className="min-h-11 min-w-11 text-over-text">✕</button></form>
              </li>
            ))}
          </ul>
          <ActionForm action={saveRule} submit="Activar redondeo" tone="plain" className="flex gap-2">
            <input type="hidden" name="goalId" value={id} /><input type="hidden" name="spaceId" value={g.space_id} /><input type="hidden" name="kind" value="roundup" />
            <input name="value" inputMode="decimal" placeholder="1,00" aria-label="Redondear al siguiente" className={`${inputClass} font-mono`} />
          </ActionForm>
          <ActionForm action={saveRule} submit="Activar % de ingresos" tone="plain" className="flex gap-2">
            <input type="hidden" name="goalId" value={id} /><input type="hidden" name="spaceId" value={g.space_id} /><input type="hidden" name="kind" value="percent_of_income" />
            <input name="value" inputMode="decimal" placeholder="10" aria-label="Porcentaje de cada ingreso" className={`${inputClass} font-mono`} />
          </ActionForm>
          <p className="text-xs text-ink-3">El redondeo solo se aplica a gastos de tu burbuja personal.</p>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-semibold">Aportaciones</h2>
        <ul className="flex flex-col gap-2">
          {contribs?.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
              <span>{SOURCE[c.source as keyof typeof SOURCE]}<span className="block text-xs text-ink-3">{c.contributed_at}</span></span>
              <span className="flex items-center gap-2">
                <span className="money font-mono">{formatMoney(c.amount_cents)}</span>
                {(c.source === "manual" || c.source === "challenge") && c.member_id === me?.id && (
                  <form action={deleteContribution}><input type="hidden" name="contributionId" value={c.id} /><input type="hidden" name="goalId" value={id} /><button aria-label="Borrar aportación" className="min-h-11 min-w-11 text-over-text">✕</button></form>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {canEdit && <form action={deleteGoal}><input type="hidden" name="goalId" value={id} /><button className="min-h-11 w-full rounded-full border border-border font-semibold text-over-text">Borrar meta</button></form>}
    </section>
  );
}
