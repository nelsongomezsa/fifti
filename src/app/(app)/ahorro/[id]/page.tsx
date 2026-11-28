import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { challenge52, formatMoney, goalProgress, monthlyNeeded } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { goalPace } from "@/lib/goal-pace";
import { addContribution, addMilestone, deleteContribution, deleteGoal, deleteRule, saveRule, toggleMilestone, updateGoal } from "@/server/actions/savings";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Meta de ahorro" };

const SOURCE = { manual: "Manual", roundup: "Redondeo", income_rule: "% del ingreso", month_surplus: "Sobrante del mes", challenge: "Reto" } as const;

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const x = await getTx();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();
  const { data: g } = await supabase.from("savings_goals").select("*").eq("id", id).maybeSingle();
  if (!g) redirect("/plan?vista=ahorro"); // borrada o sin acceso
  const [{ data: contribs }, { data: miles }, { data: rules }, { data: me }, { data: members }, { data: sp }] = await Promise.all([
    supabase.from("goal_contributions").select("id, amount_cents, source, contributed_at, member_id").eq("goal_id", id).order("contributed_at", { ascending: false }).limit(100),
    supabase.from("goal_milestones").select("id, name, due_on, amount_cents, paid").eq("goal_id", id).order("due_on", { ascending: true, nullsFirst: false }),
    supabase.from("saving_rules").select("id, kind, value, active").eq("goal_id", id),
    supabase.from("space_members").select("id, role").eq("space_id", g.space_id).eq("user_id", user.id).maybeSingle(),
    supabase.from("space_members").select("id, display_name").eq("space_id", g.space_id),
    supabase.from("spaces").select("kind").eq("id", g.space_id).maybeSingle(),
  ]);
  const canEdit = me && me.role !== "guest";
  const total = (contribs ?? []).reduce((a, c) => a + c.amount_cents, 0);
  const p = goalProgress(g.target_cents, total, (miles ?? []).map((m) => ({ amountCents: m.amount_cents, paid: m.paid })));
  const need = monthlyNeeded(p.remaining, g.deadline, new Date().toISOString().slice(0, 10));
  const todayIso = new Date().toISOString().slice(0, 10);
  const pace = goalPace((contribs ?? []).map((c) => ({ date: c.contributed_at as string, cents: c.amount_cents })), g.target_cents, todayIso);
  const shared = sp?.kind !== "personal";
  const memberName = (mid: string) => members?.find((m) => m.id === mid)?.display_name ?? "—";
  const step = (rules ?? []).find((r) => r.kind === "weekly_challenge")?.value ?? 100;
  const weeks = challenge52(step);
  const doneWeeks = (contribs ?? []).filter((c) => c.source === "challenge").length;
  const nextWeek = weeks[Math.min(doneWeeks, 51)]!;

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/ahorro" className="text-sm text-ink-2">{x("‹ Ahorro")}</Link>
      <div>
        <h1 className="text-2xl font-bold">{g.emoji ? `${g.emoji} ` : ""}{g.name}</h1>
        <p className="money mt-1 font-mono text-3xl">{formatMoney(p.contributed, "EUR", x.locale)} <span className="text-base text-ink-3">{x("de")}{" "}{formatMoney(g.target_cents, "EUR", x.locale)}</span></p>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.round(p.pctBp / 100)} aria-valuemin={0} aria-valuemax={100} aria-label={x("Progreso")}>
          <div className="h-full rounded-full bg-lilac" style={{ width: `${p.pctBp / 100}%` }} />
        </div>
        <p className="mt-2 text-sm text-ink-2">{x("Faltan")}{" "}<span className="money font-mono">{formatMoney(p.remaining, "EUR", x.locale)}</span>{g.deadline ? ` · hasta el ${g.deadline}` : ""}{need > 0 ? <> {x("· ahorra")}{" "}<span className="money font-mono">{formatMoney(need, "EUR", x.locale)}</span> {x("al mes")}</> : null}</p>
        {g.kind === "big_event" && <p className="money mt-1 font-mono text-sm text-ink-3">{x("Disponible")}{" "}{formatMoney(p.available, "EUR", x.locale)} {x("· pagos pendientes")}{" "}{formatMoney(p.unpaidMilestones, "EUR", x.locale)}</p>}
      </div>

      <div className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold">{x("Evolución")}</h2>
        {pace.series.length < 1 ? <p className="text-sm text-ink-3">{x("Cuando aportes verás aquí cómo crece.")}</p> : (
          <>
            <svg viewBox="0 0 300 90" className="h-24 w-full" role="img" aria-label={`${x("Evolución de la meta")}: ${formatMoney(pace.series[pace.series.length - 1]!.totalCents, "EUR", x.locale)} ${x("de")} ${formatMoney(g.target_cents, "EUR", x.locale)}`}>
              <line x1="0" x2="300" y1="6" y2="6" stroke="var(--border)" strokeDasharray="3 3" />
              {(() => {
                const pts = pace.series.map((s, i) => [pace.series.length === 1 ? 150 : 6 + (i * 288) / (pace.series.length - 1), 84 - Math.min(1, s.totalCents / g.target_cents) * 78] as const);
                const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
                return <><path d={`${d} L${pts[pts.length - 1]![0].toFixed(1)} 84 L${pts[0]![0].toFixed(1)} 84 Z`} fill="var(--lilac)" opacity="0.18" /><path d={d} fill="none" stroke="var(--lilac)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />{pts.map(([px, py], i) => <circle key={i} cx={px} cy={py} r="3.5" fill="var(--lilac)" />)}</>;
              })()}
            </svg>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="t-label">{x("Lo que falta")}</dt><dd className="money font-mono">{formatMoney(p.remaining, "EUR", x.locale)}</dd></div>
              <div><dt className="t-label">{x("Ritmo medio")}</dt><dd className="money font-mono">{formatMoney(pace.avgPerMonthCents, "EUR", x.locale)} {x("al mes")}</dd></div>
              <div className="col-span-2"><dt className="t-label">{x("Llegada estimada")}</dt><dd>{pace.reached ? x("¡Meta alcanzada!") : pace.etaDate ? new Date(`${pace.etaDate}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" }) : x("Aporta para calcularla")}</dd></div>
            </dl>
          </>
        )}
      </div>

      {canEdit && (
        <ActionForm action={addContribution} optimistic submit={x("Aportar")} className="flex gap-2">
          <input type="hidden" name="goalId" value={id} />
          <input name="amount" required inputMode="decimal" placeholder="50,00" aria-label={x("Importe")} className={`${inputClass} font-mono`} />
        </ActionForm>
      )}

      {g.kind === "challenge" && (
        <div className="rounded-card border border-border bg-surface p-4">
          <h2 className="font-semibold">{x("Reto de las 52 semanas")}</h2>
          <p className="mt-1 text-sm text-ink-2">{x("Semana")}{" "}{nextWeek.week}: <span className="money font-mono">{formatMoney(nextWeek.amountCents, "EUR", x.locale)}</span> {x("· llevas")}{" "}{doneWeeks} {x("de 52")}</p>
          {canEdit && doneWeeks < 52 && (
            <ActionForm action={addContribution} optimistic submit={`${x("Aportar semana")} ${nextWeek.week}`} className="mt-3 flex">
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
          <h2 className="text-lg font-semibold">{x("Pagos programados")}</h2>
          {(miles ?? []).length === 0 && <p className="text-sm text-ink-3">{x("Añade los pagos a proveedores con su fecha.")}</p>}
          <ul className="flex flex-col gap-2">
            {miles?.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
                <span className={m.paid ? "text-ink-3 line-through" : ""}>{m.name}<span className="block text-xs text-ink-3">{m.due_on ?? "sin fecha"}</span></span>
                <span className="flex items-center gap-2">
                  <span className="money font-mono">{formatMoney(m.amount_cents, "EUR", x.locale)}</span>
                  {canEdit && <form action={toggleMilestone}><input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="goalId" value={id} /><input type="hidden" name="paid" value={m.paid ? "0" : "1"} />
                    <button className="min-h-11 rounded-full border border-border px-3 text-xs">{m.paid ? x("Deshacer") : x("Pagado")}</button></form>}
                </span>
              </li>
            ))}
          </ul>
          {canEdit && (
            <ActionForm action={addMilestone} optimistic submit={x("Añadir pago")} tone="plain" className="flex flex-col gap-2">
              <input type="hidden" name="goalId" value={id} /><input type="hidden" name="spaceId" value={g.space_id} />
              <input name="name" required maxLength={60} placeholder={x("Fotógrafo")} aria-label={x("Concepto del pago")} className={inputClass} />
              <input name="amount" required inputMode="decimal" placeholder="800,00" aria-label={x("Importe del pago")} className={`${inputClass} font-mono`} />
              <input name="dueOn" type="date" aria-label={x("Fecha del pago")} className={inputClass} />
            </ActionForm>
          )}
        </div>
      )}

      {canEdit && g.kind !== "challenge" && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{x("Reglas automáticas")}</h2>
          <ul className="flex flex-col gap-2">
            {rules?.filter((r) => r.kind !== "weekly_challenge").map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
                <span>{r.kind === "roundup" ? `${x("Redondeo al siguiente")} ${formatMoney(r.value, "EUR", x.locale)}` : `${(r.value / 100).toFixed(2).replace(".", ",")} % de cada ingreso`}</span>
                <form action={deleteRule}><input type="hidden" name="ruleId" value={r.id} /><input type="hidden" name="goalId" value={id} /><button aria-label={x("Quitar regla")} className="min-h-11 min-w-11 text-over-text">✕</button></form>
              </li>
            ))}
          </ul>
          <ActionForm action={saveRule} optimistic submit={x("Activar redondeo")} tone="plain" className="flex gap-2">
            <input type="hidden" name="goalId" value={id} /><input type="hidden" name="spaceId" value={g.space_id} /><input type="hidden" name="kind" value="roundup" />
            <input name="value" inputMode="decimal" placeholder="1,00" aria-label={x("Redondear al siguiente")} className={`${inputClass} font-mono`} />
          </ActionForm>
          <ActionForm action={saveRule} optimistic submit={x("Activar % de ingresos")} tone="plain" className="flex gap-2">
            <input type="hidden" name="goalId" value={id} /><input type="hidden" name="spaceId" value={g.space_id} /><input type="hidden" name="kind" value="percent_of_income" />
            <input name="value" inputMode="decimal" placeholder="10" aria-label={x("Porcentaje de cada ingreso")} className={`${inputClass} font-mono`} />
          </ActionForm>
          <p className="text-xs text-ink-3">{x("El redondeo solo se aplica a gastos de tu burbuja personal.")}</p>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-semibold">{x("Aportaciones")}</h2>
        <ul className="flex flex-col gap-2">
          {contribs?.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
              <span>{x(SOURCE[c.source as keyof typeof SOURCE])}<span className="block text-xs text-ink-3">{new Date(`${c.contributed_at}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}{shared ? ` · ${memberName(c.member_id)}` : ""}</span></span>
              <span className="flex items-center gap-2">
                <span className="money font-mono">{formatMoney(c.amount_cents, "EUR", x.locale)}</span>
                {(c.source === "manual" || c.source === "challenge") && c.member_id === me?.id && (
                  <form action={deleteContribution}><input type="hidden" name="contributionId" value={c.id} /><input type="hidden" name="goalId" value={id} /><button aria-label={x("Borrar aportación")} className="min-h-11 min-w-11 text-over-text">✕</button></form>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {canEdit && (
        <details className="rounded-card border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">{x("Editar meta")}</summary>
          <ActionForm action={updateGoal} optimistic submit={x("Guardar meta")} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="goalId" value={id} />
            <input name="name" required maxLength={60} defaultValue={g.name} aria-label={x("Nombre")} className={inputClass} />
            <input name="target" required inputMode="decimal" defaultValue={(g.target_cents / 100).toFixed(2).replace(".", ",")} aria-label={x("Objetivo")} className={`${inputClass} font-mono`} />
            <label className="flex flex-col gap-1 text-xs text-ink-3">{x("Fecha límite (opcional)")}<input type="date" name="deadline" defaultValue={g.deadline ?? ""} className={inputClass} /></label>
          </ActionForm>
        </details>
      )}
      {canEdit && <form action={deleteGoal}><input type="hidden" name="goalId" value={id} /><button className="min-h-11 w-full rounded-full border border-border font-semibold text-over-text">{x("Borrar meta")}</button></form>}
    </section>
  );
}
