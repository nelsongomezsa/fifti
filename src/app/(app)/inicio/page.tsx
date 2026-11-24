import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { FundRowLink } from "@/components/home/FundRowLink";
import { PartnerInvite } from "@/components/home/PartnerInvite";
import { SetupPlanCard } from "@/components/plan/SetupPlanCard";
import { OptimisticLeftover } from "@/components/expense/optimistic";
import { getLocale, getTranslations } from "next-intl/server";
import { dailyBudgetLeft } from "@/lib/fx";
import { formatMoney, monthStart } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { loadSpaceBalance } from "@/server/balance";
import { Suspense } from "react";
import { ChangeLine, ChartCard } from "@/components/home/Deferred";
import { upcomingCharges } from "@/lib/calendar";
import { weeklyBudget } from "@/lib/weekly";
import { loadLoans, loanTotals } from "@/server/loans";
import { loadOverview, startSeries } from "@/server/overview";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Inicio" };

export default async function HomePage() {
  const [x, user, spaces, t, locale] = await Promise.all([getTx(), requireUser(), listMySpaces(), getTranslations("home"), getLocale()]);
  const active = await getActiveSpace(spaces);
  if (!active) return null;
  const supabase = await createClient();

  // La serie de 6 meses arranca ya, pero no bloquea las cifras: la gráfica y la variación llegan después (Suspense)
  const seriesP = startSeries(supabase, active.id, active.kind);
  // Resumen, saldo del grupo y presupuesto del día no dependen entre sí: se piden a la vez.
  const [o, balance, budget, loanRows, { data: recRows }] = await Promise.all([
    loadOverview(supabase, active.id, active.kind, undefined, undefined, x.locale, true),
    active.kind !== "personal" ? loadSpaceBalance(supabase, active.id) : Promise.resolve(null),
    (async () => {
      if (active.kind !== "group") return null;
      const { data: sp } = await supabase.from("spaces").select("daily_budget_cents").eq("id", active.id).maybeSingle();
      if (!sp?.daily_budget_cents) return null;
      const day = new Date().toISOString().slice(0, 10);
      const [{ data: ex }, { count }] = await Promise.all([
        supabase.from("expenses").select("amount_base_cents").eq("space_id", active.id).eq("spent_at", day).eq("paid_from", "member"),
        supabase.from("space_members").select("id", { count: "exact", head: true }).eq("space_id", active.id),
      ]);
      return dailyBudgetLeft(sp.daily_budget_cents, count ?? 1, (ex ?? []).reduce((a, e) => a + e.amount_base_cents, 0));
    })(),
    active.kind === "personal" && !user.is_anonymous ? loadLoans(supabase, user.id) : Promise.resolve([]),
    supabase.from("recurring_expenses").select("id, description, amount_cents, frequency, day, next_run").eq("space_id", active.id).eq("active", true),
  ]);
  const loans = loanTotals(loanRows);
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = upcomingCharges((recRows ?? []).map((r) => ({ id: r.id, description: r.description, amountCents: r.amount_cents, frequency: r.frequency, day: r.day, nextRun: r.next_run, spaceId: active.id })), [], todayIso, 30).slice(0, 3);
  const whenLabel = (iso: string) => { const d = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86400000); return d === 0 ? x("Hoy") : d === 1 ? x("Mañana") : new Date(`${iso}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", timeZone: "UTC" }); };
  const monthName = new Date(`${o.month}T00:00:00Z`).toLocaleDateString(locale, { month: "long", timeZone: "UTC" });
  const pctText = (bp: number) => `${(bp / 100).toFixed(0)} %`;
  const hasData = o.income > 0 || o.spent > 0;

  let transfer: { from: string; to: string; amountCents: number } | null = null;
  let transferMine: "owed" | "owe" | null = null;
  if (balance) {
    const me = balance.members.find((m) => m.user_id === user.id);
    const tr = balance.transfers.find((q) => q.from === me?.id || q.to === me?.id) ?? balance.transfers[0];
    if (tr) transferMine = tr.to === me?.id ? "owed" : tr.from === me?.id ? "owe" : null;
    if (tr) transfer = { from: balance.members.find((m) => m.id === tr.from)?.display_name ?? "—", to: balance.members.find((m) => m.id === tr.to)?.display_name ?? "—", amountCents: tr.amountCents };
  }
  const budgetLeft: number | null = budget;
  const weekly = o.plan.configured && active.kind !== "group" ? weeklyBudget(o.funds, new Date().toISOString().slice(0, 10)) : null;
  const today = new Date();
  const showSummary = today.getUTCDate() <= 3 && o.month === monthStart(today);

  return (
    <section className="flex flex-col gap-5 pt-2">
      {showSummary && (
        <Link href="/resumen-mensual" className="rounded-card border border-border bg-surface p-4 text-sm">
          <span className="font-semibold">{t("summaryReady")}</span>
          <span className="block text-ink-3">{t("summaryCta")}</span>
        </Link>
      )}

      {active.kind === "personal" && (loans.owedToMe > 0 || loans.iOwe > 0) && (
        <Link href="/prestamos" className="flex min-h-12 items-center justify-between rounded-card border border-border bg-surface px-4 text-sm">
          <span className="money font-mono">{x("Te deben")} {formatMoney(loans.owedToMe, "EUR", x.locale)} · {x("Debes")} {formatMoney(loans.iOwe, "EUR", x.locale)}</span>
          <span aria-hidden className="text-ink-3">›</span>
        </Link>
      )}
      {!user.is_anonymous && active.kind === "personal" && !spaces.some((sp) => sp.kind === "household") && <PartnerInvite />}
      {active.kind === "household" && balance && balance.members.length === 1 && <PartnerInvite spaceId={active.id} dismissible={false} />}

      {!o.plan.configured ? (
        <>
          <div>
            <p className="text-sm text-ink-3">{x("Gastado este mes")}</p>
            <p className="money font-mono text-5xl font-semibold">{formatMoney(o.spent, "EUR", x.locale)}</p>
          </div>
          <SetupPlanCard />
      <Suspense fallback={<div className="h-56 animate-pulse rounded-card border border-border bg-surface" />}><ChartCard seriesP={seriesP} month={o.month} leftover={o.leftover} locale={x.locale} title={t("chartTitle")} /></Suspense>
        </>
      ) : (
        <>
      <div>
        <p className="text-sm text-ink-3">{t("leftIn", { month: monthName })}</p>
        <OptimisticLeftover base={o.leftover} spaceId={active.id} kind={active.kind} currency="EUR" />
        <Suspense fallback={<div className="mt-2 h-5 w-48 animate-pulse rounded bg-track" />}><ChangeLine seriesP={seriesP} month={o.month} leftover={o.leftover} locale={x.locale} vsPrev={t("vsPrev")} label={x("Variación frente al mes anterior")} /></Suspense>
      </div>

      {budgetLeft !== null && (
        <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-2">
          {t("budgetLeft", { amount: formatMoney(budgetLeft, "EUR", locale) })}
        </p>
      )}

      {weekly && (
        <div className={`rounded-card border bg-surface p-4 ${weekly.status === "over" ? "border-over" : weekly.status === "warn" ? "border-warn" : "border-border"}`} role="status">
          <p className="t-label">{weekly.status === "over" ? x("Te has pasado de tu gasto variable") : x("Te quedan esta semana")}</p>
          <p className={`money t-figure mt-1 ${weekly.status === "over" ? "text-over-text" : weekly.status === "warn" ? "text-warn" : ""}`}>{formatMoney(Math.abs(weekly.leftCents), "EUR", x.locale)}</p>
          <p className="mt-1 text-xs text-ink-3">{weekly.status === "over" ? x("de tu gasto variable de este mes.") : x("de tu gasto variable, repartido por los días que faltan del mes.")}</p>
        </div>
      )}

      <ul className="grid grid-cols-3 gap-2">
        {([["/inicio/ingresos", t("income"), formatMoney(o.income, "EUR", locale)], ["/inicio/ahorro", t("savingsRate"), pctText(o.savingsBp)], ["/inicio/prevision", t("forecast"), formatMoney(o.forecastLeftover, "EUR", locale)]] as const).map(([href, k, v]) => (
          <li key={href} className="@container min-w-0">
            <Link href={href} aria-label={`${k}: ${v}. ${x("Ver detalle")}`} className="block h-full rounded-card border border-border bg-surface p-3 transition-colors hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
              <span className="flex items-center justify-between gap-1 text-xs text-ink-3"><span className="truncate">{k}</span><span aria-hidden>›</span></span>
              <span className="money mt-1 block whitespace-nowrap font-mono" style={{ fontSize: "clamp(0.68rem, 15cqw, 1rem)" }}>{v}</span>
            </Link>
          </li>
        ))}
      </ul>

      {!hasData && (
        <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{t("empty")}</p>
      )}

      <Suspense fallback={<div className="h-56 animate-pulse rounded-card border border-border bg-surface" />}><ChartCard seriesP={seriesP} month={o.month} leftover={o.leftover} locale={x.locale} title={t("chartTitle")} /></Suspense>

        </>
      )}

      {balance && active.kind !== "personal" && (
        <Link href="/balance" className="flex min-h-16 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2">
          <span className="min-w-0">
            <span className="t-label block">{x("Balance")}</span>
            <span className="block truncate font-medium">
              {!transfer ? x("Todo saldado") : transferMine === "owed" ? <>{transfer.from} {x("te debe")} <span className="money font-mono">{formatMoney(transfer.amountCents, "EUR", x.locale)}</span></> : transferMine === "owe" ? <>{x("Debes")} <span className="money font-mono">{formatMoney(transfer.amountCents, "EUR", x.locale)}</span> {x("a")} {transfer.to}</> : <>{transfer.from} → {transfer.to} <span className="money font-mono">{formatMoney(transfer.amountCents, "EUR", x.locale)}</span></>}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-sm text-ink-2">{x("Ver balance")}<span aria-hidden>›</span></span>
        </Link>
      )}

      {upcoming.length > 0 && (
        <Link href="/calendario?vista=proximos" className="block rounded-card border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2" aria-label={x("Próximos cobros")}>
          <span className="flex items-center justify-between"><span className="t-label">{x("Próximos cobros")}</span><span aria-hidden className="text-ink-3">›</span></span>
          <ul className="mt-2 flex flex-col gap-1.5">
            {upcoming.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate"><span className="text-ink-3">{whenLabel(c.date)}</span> · {c.label}</span><span className="money shrink-0 font-mono">{formatMoney(c.cents, "EUR", x.locale)}</span></li>
            ))}
          </ul>
        </Link>
      )}


      {o.plan.configured && (
      <div className="rounded-card border border-border bg-surface">
        <h2 className="px-4 pt-4 text-sm text-ink-3">{t("funds")}</h2>
        <ul className="mt-1 divide-y divide-border border-t border-border">
          {o.funds.filter((f) => f.planned > 0).map((f) => (
            <li key={f.fundId}><FundRowLink href={`/inicio/fondo/${f.fundId}`} name={f.name} color={f.color} usedBp={f.usedBp} status={f.status} savings={f.kind === "savings"} statusText={f.status === "over" ? x("te has pasado") : x("vas por el 80 %")} /></li>
          ))}
        </ul>
        {o.funds.every((f) => f.planned === 0) && <p className="px-4 pb-4 pt-2 text-sm text-ink-3">{t("definePlan")}</p>}
      </div>
      )}
    </section>
  );
}
