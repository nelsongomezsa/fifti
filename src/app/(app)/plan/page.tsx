import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { PlanBubbles } from "@/components/charts/PlanBubbles";
import { detectSubscriptions } from "@/lib/detect";
import { addMonths, formatMoney, forecastMonthEnd, fundLeftover, isMonthStart, monthStart, summarizeFund } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { closePlan, copyPreviousPlan, deleteRecurring, generateContributions, markContributionPaid, reopenPlan, saveContributionRule, savePlan, saveRecurring } from "@/server/actions/plan";
import { loadMirrorByFund, loadPlan } from "@/server/plan";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Plan" };

const pctText = (bp: number) => (bp / 100).toFixed(2).replace(".", ",");
const centsText = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const FREQ = { weekly: "Semanal", monthly: "Mensual", yearly: "Anual" } as const;

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ mes?: string; vista?: string }> }) {
  const [x, sp, user, spaces] = await Promise.all([getTx(), searchParams, requireUser(), listMySpaces()]);
  const active = await getActiveSpace(spaces);
  if (!active) return null;
  const supabase = await createClient();
  const month = sp.mes && isMonthStart(sp.mes) ? sp.mes : monthStart(new Date());
  // Todas las consultas de la página en una sola ronda de red
  const sideQueries = Promise.all([
    supabase.from("recurring_expenses").select("id, description, amount_cents, frequency, day, next_run, active, category_id, paid_from").eq("space_id", active.id).order("next_run"),
    supabase.from("categories").select("id, name, system_key").eq("space_id", active.id).order("name"),
    active.kind === "household" ? supabase.from("contribution_rules").select("mode, monthly_target_cents, values").eq("space_id", active.id).maybeSingle() : Promise.resolve({ data: null }),
    active.kind === "household" ? supabase.from("contributions").select("id, member_id, expected_cents, paid_cents").eq("space_id", active.id).eq("month", month) : Promise.resolve({ data: [] }),
    supabase.from("savings_goals").select("id, name").eq("space_id", active.id),
    supabase.from("expenses").select("description, amount_base_cents, spent_at").eq("space_id", active.id).eq("is_private", false).is("recurring_id", null).gte("spent_at", addMonths(month, -6)).limit(2000),
  ]);
  const [d, [{ data: recurring }, { data: cats }, { data: rule }, { data: contribs }, { data: goals }, { data: hist }]] = await Promise.all([
    (async () => loadPlan(supabase, active.id, month, active.kind === "personal" ? await loadMirrorByFund(supabase, month) : {}))(),
    sideQueries,
  ]);
  d.funds = d.funds.map((f) => ({ ...f, name: displayName(x, f.name, f.system_key) }));
  const list = sp.vista === "lista";
  const rows = d.funds.map((f) => ({ f, row: summarizeFund(f.id, (d.allocations[f.id]?.planned ?? 0) + (d.allocations[f.id]?.carry ?? 0), d.spentByFund[f.id] ?? 0) }));
  const me = d.members.find((m) => m.user_id === user.id);
  const canEdit = !!me && me.role !== "guest" && d.plan?.status !== "closed";
  const label = new Date(`${month}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const fixedRows = rows.filter(({ f }) => f.kind === "fixed");
  const spentFixed = fixedRows.reduce((a, { row }) => a + row.spent, 0);
  const fc = forecastMonthEnd({ monthIso: month, today: new Date().toISOString().slice(0, 10), spentVariable: d.totalSpent - spentFixed, spentFixed, plannedFixed: fixedRows.reduce((a, { row }) => a + row.planned, 0), income: Object.values(d.actual).reduce((a, b) => a + b, 0) || Object.values(d.expected).reduce((a, b) => a + b, 0) });
  const expectedTotal = Object.values(d.expected).reduce((a, b) => a + b, 0);
  const actualTotal = Object.values(d.actual).reduce((a, b) => a + b, 0);

  const subs = detectSubscriptions((hist ?? []).map((h) => ({ description: h.description, amountCents: h.amount_base_cents, spentAt: h.spent_at })), (recurring ?? []).map((r) => r.description)).slice(0, 3);
  const nm = (id: string) => d.members.find((m) => m.id === id)?.display_name ?? "—";
  const myRecurring = recurring ?? [];

  return (
    <section className="flex flex-col gap-6 pt-2">
      <h1 className="text-2xl font-bold">{x("Plan")}</h1>
      <div className="flex items-center justify-between">
        <Link href={`/plan?mes=${addMonths(month, -1)}`} aria-label={x("Mes anterior")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">‹</Link>
        <span className="font-semibold first-letter:uppercase">{label}{d.plan?.status === "closed" ? ` · ${x("cerrado")}` : ""}</span>
        <Link href={`/plan?mes=${addMonths(month, 1)}`} aria-label={x("Mes siguiente")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">›</Link>
      </div>

      {!d.plan && canEdit && (
        <ActionForm action={copyPreviousPlan} submit={x("Copiar el plan del mes anterior")} tone="plain">
          <input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="month" value={month} />
        </ActionForm>
      )}

      <nav aria-label={x("Vista")} className="flex gap-2">
        <Link href={`/plan?mes=${month}`} aria-current={!list ? "page" : undefined} className={`min-h-11 rounded-full border px-4 py-2.5 text-sm ${!list ? "border-accent bg-surface-2" : "border-border text-ink-2"}`}>{x("Burbujas")}</Link>
        <Link href={`/plan?mes=${month}&vista=lista`} aria-current={list ? "page" : undefined} className={`min-h-11 rounded-full border px-4 py-2.5 text-sm ${list ? "border-accent bg-surface-2" : "border-border text-ink-2"}`}>{x("Lista")}</Link>
      </nav>

      <div className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm text-ink-3">{x("Previsión de fin de mes")}</p>
        <p className={`money font-mono text-2xl ${fc.projectedLeftover < 0 ? "text-over-text" : ""}`}>{formatMoney(fc.projectedLeftover, "EUR", x.locale)}</p>
        <p className="mt-1 text-xs text-ink-3">{x("Según tu ritmo de gasto variable y los fijos que quedan por pagar.")}</p>
      </div>

      {!list && <PlanBubbles currency="EUR" funds={rows.map(({ f, row }) => ({ id: f.id, name: f.name, color: f.color, planned: row.planned, spent: row.spent }))} />}

      <ul className={`flex flex-col gap-3 ${!list ? "sr-only" : ""}`} aria-label={x("Fondos")}>
        {rows.map(({ f, row }) => {
          const over = row.status === "over";
          return (
            <li key={f.id} className="rounded-card border border-border bg-surface p-4">
              <p className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-medium"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</span>
                <span className={`money font-mono text-sm ${over ? "text-over-text" : "text-ink-2"}`}>{Math.round(row.usedBp / 100)} %</span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuenow={Math.min(100, Math.round(row.usedBp / 100))} aria-valuemin={0} aria-valuemax={100} aria-label={`Uso de ${f.name}`}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, row.usedBp / 100)}%`, background: over ? "var(--over)" : row.status === "warn" ? "var(--warn)" : f.color }} />
              </div>
              <p className="money mt-2 flex justify-between font-mono text-xs text-ink-3">
                <span>{x("Gastado")}{" "}{formatMoney(row.spent, "EUR", x.locale)}</span><span>{x("Previsto")}{" "}{formatMoney(row.planned, "EUR", x.locale)}</span>
                <span className={over ? "text-over-text" : ""}>{x("Resta")}{" "}{formatMoney(row.remaining, "EUR", x.locale)}</span>
              </p>
              {row.status !== "ok" && <p role="status" className={`mt-1 text-xs ${over ? "text-over-text" : "text-ink-2"}`}>{over ? x("Te has pasado de este fondo.") : x("Vas por el 80 % de este fondo.")}</p>}
            </li>
          );
        })}
      </ul>
      {d.uncategorized > 0 && <p className="text-sm text-ink-3">{x("Sin categoría:")}{" "}<span className="money font-mono">{formatMoney(d.uncategorized, "EUR", x.locale)}</span></p>}

      <p className="money flex justify-between rounded-card border border-border bg-surface p-4 font-mono text-sm">
        <span>{x("Ingresos previstos")}{" "}{formatMoney(expectedTotal, "EUR", x.locale)}</span><span>{x("Reales")}{" "}{formatMoney(actualTotal, "EUR", x.locale)}</span>
      </p>

      {canEdit && (
        <details className="rounded-card border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">{x("Editar plan")}</summary>
          <ActionForm action={savePlan} submit={x("Guardar plan")} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="month" value={month} />
            <h3 className="text-sm text-ink-3">{x("Ingresos previstos")}</h3>
            {d.members.map((m) => (
              <label key={m.id} className="flex items-center justify-between gap-3 text-sm text-ink-2">
                {m.display_name}
                <input name={`inc_${m.id}`} inputMode="decimal" defaultValue={d.expected[m.id] !== undefined ? centsText(d.expected[m.id]!) : ""} placeholder="0,00" aria-label={`Ingreso previsto de ${m.display_name}`}
                  className="min-h-11 w-32 rounded-card border border-border bg-surface-2 px-3 text-right font-mono text-ink" />
              </label>
            ))}
            <h3 className="mt-2 text-sm text-ink-3">{x("Fondos (% de los ingresos o importe fijo)")}</h3>
            {d.funds.map((f) => {
              const a = d.allocations[f.id];
              return (
                <div key={f.id} className="flex items-center justify-between gap-2 text-sm text-ink-2">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <select name={`mode_${f.id}`} defaultValue={a?.mode ?? "percent"} aria-label={`Tipo de ${f.name}`} className="min-h-11 rounded-card border border-border bg-surface-2 px-2 text-ink">
                    <option value="percent">%</option><option value="amount">€</option>
                  </select>
                  <input name={`val_${f.id}`} inputMode="decimal" defaultValue={a ? (a.mode === "percent" ? pctText(a.value) : centsText(a.value)) : ""} placeholder="0" aria-label={`Valor de ${f.name}`}
                    className="min-h-11 w-24 rounded-card border border-border bg-surface-2 px-3 text-right font-mono text-ink" />
                </div>
              );
            })}
            <textarea name="notes" maxLength={500} defaultValue={d.plan?.notes ?? ""} placeholder={x("Notas del mes")} aria-label={x("Notas")} className={`${inputClass} py-3`} />
          </ActionForm>
        </details>
      )}

      {d.plan?.status === "closed" ? (
        me?.role === "owner" || (active.kind === "personal" && me) ? (
          <form action={reopenPlan}><input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="month" value={month} />
            <button className="min-h-11 w-full rounded-full border border-border font-semibold">{x("Reabrir el mes")}</button></form>
        ) : null
      ) : d.plan && (me?.role === "owner" || (active.kind === "personal" && me)) && (
        <details className="rounded-card border border-border bg-surface p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">{x("Cerrar el mes")}</summary>
          <p className="mt-2 text-xs text-ink-3">{x("Decide qué pasa con el sobrante de cada fondo. El mes quedará en solo lectura y podrás reabrirlo.")}</p>
          <ActionForm action={closePlan} submit={x("Cerrar mes")} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="month" value={month} />
            {rows.map(({ f }) => {
              const a = d.allocations[f.id];
              const left = fundLeftover(a?.planned ?? 0, a?.carry ?? 0, d.spentByFund[f.id] ?? 0);
              return (
                <label key={f.id} className="flex items-center justify-between gap-3 text-sm text-ink-2">
                  <span>{f.name} <span className="money font-mono text-ink">{formatMoney(left, "EUR", x.locale)}</span></span>
                  <select name={`act_${f.id}`} defaultValue={f.rollover ? "rollover" : "free"} disabled={left <= 0} aria-label={`Qué hacer con el sobrante de ${f.name}`} className="min-h-11 rounded-card border border-border bg-surface-2 px-2 text-ink">
                    <option value="rollover">{x("Pasa al mes siguiente")}</option><option value="free">{x("Queda libre")}</option>{goals?.map((g) => <option key={g.id} value={`goal:${g.id}`}>{x("A la meta:")}{" "}{g.name}</option>)}
                  </select>
                </label>
              );
            })}
          </ActionForm>
        </details>
      )}

      {me && me.role !== "guest" && subs.map((c) => (
        <div key={c.description} className="rounded-card border border-border bg-surface p-4 text-sm">
          <p><strong>{c.description}</strong> {x("se repite cada mes (")}<span className="money font-mono">{formatMoney(c.amountCents, "EUR", x.locale)}</span>, {c.months} {x("meses seguidos). ¿Lo pasamos a gasto fijo?")}</p>
          <ActionForm action={saveRecurring} submit={x("Pasar a gasto fijo")} tone="plain" className="mt-2">
            <input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="description" value={c.description} />
            <input type="hidden" name="amount" value={(c.amountCents / 100).toFixed(2).replace(".", ",")} /><input type="hidden" name="day" value={c.day} />
            <input type="hidden" name="frequency" value="monthly" /><input type="hidden" name="detected" value="1" />
            <input type="hidden" name="nextRun" value={`${addMonths(monthStart(new Date()), 1).slice(0, 8)}${String(Math.min(c.day, 28)).padStart(2, "0")}`} />
          </ActionForm>
        </div>
      ))}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{x("Gastos fijos")}</h2>
        {myRecurring.length === 0 ? <p className="text-sm text-ink-3">{x("Aún no hay gastos fijos.")}</p> : (
          <ul className="flex flex-col gap-2">
            {myRecurring.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
                <span>{r.description}<span className="block text-xs text-ink-3">{x(FREQ[r.frequency as keyof typeof FREQ])} {x("· próximo")}{" "}{r.next_run}{r.paid_from === "pot" ? " · del bote" : ""}</span></span>
                <span className="flex items-center gap-2">
                  <span className="money font-mono">{formatMoney(r.amount_cents, "EUR", x.locale)}</span>
                  <form action={deleteRecurring}><input type="hidden" name="recurringId" value={r.id} /><button aria-label={`Borrar ${r.description}`} className="min-h-11 min-w-11 text-over-text">✕</button></form>
                </span>
              </li>
            ))}
          </ul>
        )}
        {me && me.role !== "guest" && (
          <details className="rounded-card border border-border bg-surface p-4">
            <summary className="min-h-11 cursor-pointer font-semibold">{x("Añadir gasto fijo")}</summary>
            <ActionForm action={saveRecurring} submit={x("Guardar gasto fijo")} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="spaceId" value={active.id} />
              <input name="description" required maxLength={120} placeholder={x("Alquiler")} aria-label={x("Concepto")} className={inputClass} />
              <input name="amount" required inputMode="decimal" placeholder="650,00" aria-label={x("Importe")} className={`${inputClass} font-mono`} />
              <div className="grid grid-cols-2 gap-3">
                <select name="frequency" defaultValue="monthly" aria-label={x("Frecuencia")} className={inputClass}>{Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{x(l)}</option>)}</select>
                <input name="day" type="number" min={1} max={31} defaultValue={1} aria-label={x("Día del mes")} className={inputClass} />
              </div>
              <label className="flex flex-col gap-1 text-xs text-ink-3">{x("Primer cobro")}<input name="nextRun" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} /></label>
              <select name="categoryId" defaultValue="" aria-label={x("Categoría")} className={inputClass}><option value="">{x("Sin categoría")}</option>{cats?.map((c) => <option key={c.id} value={c.id}>{displayName(x, c.name, c.system_key)}</option>)}</select>
              {active.kind === "household" && <select name="paidFrom" aria-label={x("Quién paga")} className={inputClass}><option value="member">{x("Lo pago yo")}</option><option value="pot">{x("Sale del bote común")}</option></select>}
            </ActionForm>
          </details>
        )}
      </div>

      {active.kind === "household" && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{x("Bote común y aportaciones")}</h2>
          {me?.role === "owner" && (
            <details className="rounded-card border border-border bg-surface p-4">
              <summary className="min-h-11 cursor-pointer font-semibold">{x("Regla de aportación")}</summary>
              <ActionForm action={saveContributionRule} submit={x("Guardar regla")} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="spaceId" value={active.id} />
                <select name="mode" defaultValue={rule?.mode ?? "proportional_to_income"} aria-label={x("Modo")} className={inputClass}>
                  <option value="proportional_to_income">{x("Proporcional a los ingresos")}</option>
                  <option value="fixed_percent">{x("Porcentaje fijo")}</option>
                  <option value="fixed_amount">{x("Importe fijo")}</option>
                </select>
                <input name="target" inputMode="decimal" defaultValue={rule ? centsText(rule.monthly_target_cents) : ""} placeholder={x("Bote mensual (1.200,00)")} aria-label={x("Bote mensual")} className={`${inputClass} font-mono`} />
                <p className="text-xs text-ink-3">{x("Solo para % o importe fijo: un valor por persona (% o €).")}</p>
                {d.members.map((m) => (
                  <label key={m.id} className="flex items-center justify-between gap-3 text-sm text-ink-2">{m.display_name}
                    <input name={`rv_${m.id}`} inputMode="decimal" defaultValue={rule?.values && (rule.values as Record<string, number>)[m.id] !== undefined ? String((rule.values as Record<string, number>)[m.id]! / 100).replace(".", ",") : ""}
                      aria-label={`Valor de ${m.display_name}`} className="min-h-11 w-28 rounded-card border border-border bg-surface-2 px-3 text-right font-mono text-ink" /></label>
                ))}
              </ActionForm>
              <ActionForm action={generateContributions} submit={x("Calcular aportaciones del mes")} tone="plain" className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="month" value={month} />
              </ActionForm>
            </details>
          )}
          {(contribs ?? []).length === 0 ? <p className="text-sm text-ink-3">{x("Calcula las aportaciones del mes con la regla.")}</p> : (
            <ul className="flex flex-col gap-2">
              {contribs!.map((c) => {
                const mineOrOwner = d.members.find((m) => m.id === c.member_id)?.user_id === user.id || me?.role === "owner";
                return (
                  <li key={c.id} className="rounded-card border border-border bg-surface px-4 py-3 text-sm">
                    <p className="flex justify-between"><span>{nm(c.member_id)}</span>
                      <span className="money font-mono">{formatMoney(c.paid_cents, "EUR", x.locale)} / {formatMoney(c.expected_cents, "EUR", x.locale)}</span></p>
                    {mineOrOwner && d.plan?.status !== "closed" && (
                      <ActionForm action={markContributionPaid} submit={c.paid_cents > 0 ? x("Actualizar") : x("Marcar como hecha")} tone="plain" className="mt-2 flex gap-2">
                        <input type="hidden" name="contributionId" value={c.id} />
                        <input name="paid" inputMode="decimal" defaultValue={centsText(c.paid_cents > 0 ? c.paid_cents : c.expected_cents)} aria-label={x("Importe aportado")} className={`${inputClass} font-mono`} />
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
