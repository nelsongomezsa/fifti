import { SwipeRow } from "@/components/movements/SwipeRow";
import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { rotationPayer } from "@/lib/calendar";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { SetupPlanCard } from "@/components/plan/SetupPlanCard";
import { SavingsTab } from "@/components/plan/SavingsTab";
import { SheetButton } from "@/components/ui/SheetButton";
import { detectSubscriptions } from "@/lib/detect";
import { addMonths, formatMoney, fundLeftover, isMonthStart, monthOutlook, monthStart, summarizeFund } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { closePlan, copyPreviousPlan, deleteRecurring, generateContributions, markContributionPaid, reopenPlan, saveContributionRule, savePlan, saveRecurring } from "@/server/actions/plan";
import { loadMirrorByFund, loadPlan } from "@/server/plan";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Plan" };

const pctText = (bp: number) => (bp / 100).toFixed(2).replace(".", ",");
const centsText = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const FREQ = { weekly: "Semanal", monthly: "Mensual", quarterly: "Trimestral", yearly: "Anual" } as const;

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ mes?: string; vista?: string }> }) {
  const [x, sp, user, spaces] = await Promise.all([getTx(), searchParams, requireUser(), listMySpaces()]);
  const active = await getActiveSpace(spaces);
  if (!active) return null;
  const supabase = await createClient();
  const month = sp.mes && isMonthStart(sp.mes) ? sp.mes : monthStart(new Date());
  // Todas las consultas de la página en una sola ronda de red
  const sideQueries = Promise.all([
    supabase.from("recurring_expenses").select("id, description, amount_cents, frequency, day, next_run, active, category_id, paid_from, rotation, rotation_pos").eq("space_id", active.id).order("next_run"),
    supabase.from("categories").select("id, name, system_key, fund_id").eq("space_id", active.id).order("name"),
    supabase.from("category_rules").select("id, match_text, match_type, category_id, priority").eq("space_id", active.id),
    active.kind === "household" ? supabase.from("contribution_rules").select("mode, monthly_target_cents, values").eq("space_id", active.id).maybeSingle() : Promise.resolve({ data: null }),
    active.kind === "household" ? supabase.from("contributions").select("id, member_id, expected_cents, paid_cents").eq("space_id", active.id).eq("month", month) : Promise.resolve({ data: [] }),
    supabase.from("savings_goals").select("id, name").eq("space_id", active.id),
    supabase.from("expenses").select("description, amount_base_cents, spent_at").eq("space_id", active.id).eq("is_private", false).is("recurring_id", null).gte("spent_at", addMonths(month, -6)).limit(2000),
  ]);
  const [d, [{ data: recurring }, { data: cats }, { data: catRules }, { data: rule }, { data: contribs }, { data: goals }, { data: hist }]] = await Promise.all([
    (async () => loadPlan(supabase, active.id, month, active.kind === "personal" ? await loadMirrorByFund(supabase, month) : {}, { uncategorizedToDaily: active.kind === "personal" }))(),
    sideQueries,
  ]);
  d.funds = d.funds.map((f) => ({ ...f, name: displayName(x, f.name, f.system_key) }));
  const list = sp.vista === "lista";
  const rows = d.funds.map((f) => ({ f, row: summarizeFund(f.id, (d.allocations[f.id]?.planned ?? 0) + (d.allocations[f.id]?.carry ?? 0), d.spentByFund[f.id] ?? 0) }));
  const me = d.members.find((m) => m.user_id === user.id);
  const canEdit = !!me && me.role !== "guest" && d.plan?.status !== "closed";
  const label = new Date(`${month}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const outlook = monthOutlook(Object.values(d.actual).reduce((a, b) => a + b, 0) || Object.values(d.expected).reduce((a, b) => a + b, 0), d.totalSpent, rows.map(({ f, row }) => ({ kind: f.kind, planned: row.planned, spent: row.spent })));
  const expectedTotal = Object.values(d.expected).reduce((a, b) => a + b, 0);
  const actualTotal = Object.values(d.actual).reduce((a, b) => a + b, 0);

  const subs = detectSubscriptions((hist ?? []).map((h) => ({ description: h.description, amountCents: h.amount_base_cents, spentAt: h.spent_at })), (recurring ?? []).map((r) => r.description)).slice(0, 3);
  const nm = (id: string) => d.members.find((m) => m.id === id)?.display_name ?? "—";
  const myRecurring = recurring ?? [];
  const tab = sp.vista === "fijos" || sp.vista === "ahorro" ? sp.vista : "presupuesto";
  const incomeMonth = Object.values(d.actual).reduce((a, b) => a + b, 0) || Object.values(d.expected).reduce((a, b) => a + b, 0);
  const plannedTotal = rows.reduce((a, { row }) => a + row.planned, 0);

  return (
    <section className="flex flex-col gap-6 pt-2">
      <ScrollToHash />
      <h1 className="text-2xl font-bold">{x("Plan")}</h1>
      <nav aria-label={x("Vista")} className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {([["presupuesto", x("Presupuesto")], ["fijos", `${x("Fijos")} · ${myRecurring.length}`], ["ahorro", `${x("Ahorro")} · ${(goals ?? []).length}`]] as const).map(([v, l]) => (
          <Link prefetch key={v} href={`/plan?vista=${v}&mes=${month}`} aria-current={tab === v ? "page" : undefined} className={`flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium ${tab === v ? "border-accent bg-surface-2 text-ink" : "border-border text-ink-2"}`}>{l}</Link>
        ))}
      </nav>
      {tab === "presupuesto" && (
        <div className="flex items-center justify-between">
          <Link prefetch href={`/plan?vista=${tab}&mes=${addMonths(month, -1)}`} aria-label={x("Mes anterior")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">‹</Link>
          <span className="font-semibold first-letter:uppercase">{label}{d.plan?.status === "closed" ? ` · ${x("cerrado")}` : ""}</span>
          <Link prefetch href={`/plan?vista=${tab}&mes=${addMonths(month, 1)}`} aria-label={x("Mes siguiente")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">›</Link>
        </div>
      )}

      {tab === "presupuesto" && (
        <>
      {d.configured ? (
        <>
          <div className="rounded-card border border-border bg-surface p-5">
            <p className="t-label">{x("Ingresos del mes")}</p>
            <p className="money t-figure mt-1">{formatMoney(incomeMonth, "EUR", x.locale)}</p>
            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-track" role="img" aria-label={x("Reparto del presupuesto por partidas")}>
              {rows.filter(({ row }) => row.planned > 0).map(({ f, row }) => <span key={f.id} style={{ width: `${(row.planned / Math.max(1, plannedTotal)) * 100}%`, background: f.color }} />)}
            </div>
            <p className="mt-3 text-sm text-ink-2">{x("Te sobrará a final de mes")} <span className={`money font-mono font-semibold ${outlook.projectedLeftover < 0 ? "text-over-text" : "text-ink"}`}>{formatMoney(outlook.projectedLeftover, "EUR", x.locale)}</span></p>
          </div>

          <h2 className="text-lg font-semibold">{x("Tus partidas")}</h2>
          <ul className="flex flex-col gap-3">
            {rows.map(({ f, row }) => {
              const over = row.status === "over";
              return (
                <li key={f.id}>
                  <Link href={`/inicio/fondo/${f.id}`} className="block rounded-card border border-border bg-surface p-4 transition-colors hover:bg-surface-2">
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-medium"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</span>
                      <span className={`money font-mono text-sm ${over ? "text-over-text" : row.status === "warn" ? "text-warn" : "text-ink-2"}`}>{Math.round(row.usedBp / 100)} % <span aria-hidden className="text-ink-3">›</span></span>
                    </span>
                    <span className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, row.usedBp / 100)}%`, background: f.color }} /></span>
                    <span className="money mt-2 flex justify-between font-mono text-xs text-ink-3">
                      <span>{x("Gastado")} {formatMoney(row.spent, "EUR", x.locale)} {x("de")} {formatMoney(row.planned, "EUR", x.locale)}</span>
                      <span className={over ? "text-over-text" : ""}>{over ? x("Te has pasado") : x("Quedan")} {formatMoney(Math.abs(row.remaining), "EUR", x.locale)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {d.uncategorized > 0 && <p className="text-sm text-ink-3">{x("Sin categoría:")}{" "}<span className="money font-mono">{formatMoney(d.uncategorized, "EUR", x.locale)}</span></p>}
        </>
      ) : (
        <SetupPlanCard />
      )}

          <div className="flex flex-wrap gap-3">
      {canEdit && (
        <SheetButton label={x("Cambiar reparto")} title={x("Cambiar reparto")}>
          <ActionForm action={savePlan} optimistic submit={x("Guardar plan")} className="mt-3 flex flex-col gap-3">
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
        </SheetButton>
      )}

      {d.plan?.status === "closed" ? (
        me?.role === "owner" || (active.kind === "personal" && me) ? (
          <form action={reopenPlan}><input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="month" value={month} />
            <button className="min-h-11 w-full rounded-full border border-border font-semibold">{x("Reabrir el mes")}</button></form>
        ) : null
      ) : d.plan && (me?.role === "owner" || (active.kind === "personal" && me)) && (
        <SheetButton label={x("Cerrar el mes")}>
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
        </SheetButton>
      )}

          </div>
      {active.kind === "household" && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{x("Bote común y aportaciones")}</h2>
          {me?.role === "owner" && (
            <SheetButton label={x("Regla de aportación")}>
              <ActionForm action={saveContributionRule} optimistic submit={x("Guardar regla")} className="mt-3 flex flex-col gap-3">
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
            </SheetButton>
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
                      <ActionForm action={markContributionPaid} optimistic submit={c.paid_cents > 0 ? x("Actualizar") : x("Marcar como hecha")} tone="plain" className="mt-2 flex gap-2">
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
        </>
      )}

      {tab === "fijos" && (
        <>
      {me && me.role !== "guest" && <Link href="/fijos/nuevo" className="inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 font-semibold text-on-accent">+ {x("Añadir gasto fijo")}</Link>}
      {me && me.role !== "guest" && subs.map((c) => (
        <div key={c.description} className="rounded-card border border-border bg-surface p-4 text-sm">
          <p><strong>{c.description}</strong> {x("se repite cada mes (")}<span className="money font-mono">{formatMoney(c.amountCents, "EUR", x.locale)}</span>, {c.months} {x("meses seguidos). ¿Lo pasamos a gasto fijo?")}</p>
          <ActionForm action={saveRecurring} optimistic submit={x("Pasar a gasto fijo")} tone="plain" className="mt-2">
            <input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="description" value={c.description} />
            <input type="hidden" name="amount" value={(c.amountCents / 100).toFixed(2).replace(".", ",")} /><input type="hidden" name="day" value={c.day} />
            <input type="hidden" name="frequency" value="monthly" /><input type="hidden" name="detected" value="1" />
            <input type="hidden" name="nextRun" value={`${addMonths(monthStart(new Date()), 1).slice(0, 8)}${String(Math.min(c.day, 28)).padStart(2, "0")}`} />
          </ActionForm>
        </div>
      ))}

      <div id="gastos-fijos" className="flex scroll-mt-4 flex-col gap-3">
        {myRecurring.length === 0 ? <p className="text-sm text-ink-3">{x("Aún no hay gastos fijos.")}</p> : (
          <ul className="flex flex-col gap-2">
            {myRecurring.map((r) => (
              <li key={r.id}>
                <SwipeRow id={r.id} kind="recurring">
                  <Link prefetch href={`/fijos/nuevo?id=${r.id}`} className="flex min-h-16 items-center justify-between gap-3 rounded-card border border-border bg-surface px-3 py-3 text-sm transition-colors hover:bg-surface-2">
                    <CategoryIcon systemName={cats?.find((c) => c.id === r.category_id)?.system_key} color={d.funds.find((f) => f.id === cats?.find((c) => c.id === r.category_id)?.fund_id)?.color} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.description}</span><span className="block truncate text-sm text-ink-3">{x(FREQ[r.frequency as keyof typeof FREQ])} {x("· próximo")}{" "}{new Date(`${r.next_run}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "")}{r.paid_from === "pot" ? ` · ${x("del bote")}` : ""}</span></span>
                    <span className="money shrink-0 font-mono">{formatMoney(r.amount_cents, "EUR", x.locale)}</span>
                    <span aria-hidden className="text-ink-3">›</span>
                  </Link>
                </SwipeRow>
              </li>
            ))}
          </ul>
        )}

      </div>
        </>
      )}

      {tab === "ahorro" && <SavingsTab active={active} />}
    </section>
  );
}
