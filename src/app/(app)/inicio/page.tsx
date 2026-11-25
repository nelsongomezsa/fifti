import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { PartnerInvite } from "@/components/home/PartnerInvite";
import { SetupPlanCard } from "@/components/plan/SetupPlanCard";
import { OptimisticSpent } from "@/components/expense/optimistic";
import { getLocale, getTranslations } from "next-intl/server";
import { dailyBudgetLeft } from "@/lib/fx";
import { formatMoney, monthStart } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { loadSpaceBalance } from "@/server/balance";
import { Suspense } from "react";
import { ChangeLine, ChartCard } from "@/components/home/Deferred";
import { upcomingCharges } from "@/lib/calendar";
import { AnimatedMoney } from "@/components/ui/AnimatedMoney";
import { weeklyBudget } from "@/lib/weekly";
import { PayrollSplitCard } from "@/components/accounts/PayrollSplitCard";
import { payrollSource, payrollSplit } from "@/lib/payroll-split";
import { loadAccounts } from "@/server/accounts";
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
  const [o, balance, budget, loanRows, { data: recRows }, { data: skipRows }, { data: recent }, accounts, { data: fundAcc }, { data: monthIncomes }, { data: splitDone }] = await Promise.all([
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
    supabase.from("recurring_expenses").select("id, description, amount_cents, frequency, day, next_run, categories(system_key, funds(color))").eq("space_id", active.id).eq("active", true),
    supabase.from("recurring_skips").select("recurring_id, skip_on"),
    supabase.from("expenses").select("id, description, spent_at, amount_cents, currency, categories(system_key, funds(color))").eq("space_id", active.id).order("spent_at", { ascending: false }).order("created_at", { ascending: false }).limit(3),
    user.is_anonymous ? Promise.resolve([]) : loadAccounts(supabase, user.id),
    supabase.from("funds").select("id, account_id").eq("space_id", active.id),
    supabase.from("incomes").select("account_id, source").eq("space_id", active.id).gte("received_at", monthStart(new Date())),
    supabase.from("account_transfers").select("to_account, amount_cents").eq("source", "payroll_split").gte("transfer_date", monthStart(new Date())),
  ]);
  const loans = loanTotals(loanRows);
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = upcomingCharges((recRows ?? []).map((r) => ({ id: r.id, description: r.description, amountCents: r.amount_cents, frequency: r.frequency, day: r.day, nextRun: r.next_run, spaceId: active.id })), [], todayIso, 30, new Set((skipRows ?? []).map((k) => `${k.recurring_id}|${k.skip_on}`))).slice(0, 3);
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
  // Reparto de la nómina: solo si ya hay un ingreso este mes y alguna partida tiene cuenta asociada
  const accById = new Map(accounts.map((a) => [a.id, a]));
  const payIncome = (monthIncomes ?? [])[0];
  const fromId = payIncome ? payrollSource(payIncome.account_id, accounts) : null;
  const acctOfFund = new Map((fundAcc ?? []).map((f) => [f.id, f.account_id as string | null]));
  const splitItems = (active.kind !== "group" && fromId ? payrollSplit(o.funds.map((f) => ({ plannedCents: f.planned, accountId: acctOfFund.get(f.fundId) ?? null })), fromId, (splitDone ?? []).map((d) => ({ toAccount: d.to_account, amountCents: d.amount_cents }))) : [])
    .map((s) => ({ toId: s.toAccountId, toName: accById.get(s.toAccountId)?.name ?? "—", color: accById.get(s.toAccountId)?.color ?? "#9AA3AF", cents: s.amountCents }));
  const mineAccounts = accounts.filter((a) => a.mine);
  const weekly = o.plan.configured && active.kind !== "group" ? weeklyBudget(o.funds, new Date().toISOString().slice(0, 10)) : null;
  const today = new Date();
  const showSummary = today.getUTCDate() <= 3 && o.month === monthStart(today);

  const catOf = new Map((recRows ?? []).map((r) => [r.id, r.categories as unknown as { system_key: string | null; funds: { color: string } | null } | null]));
  const budgetFunds = o.funds.filter((f) => ["fixed", "variable", "leisure", "other"].includes(f.kind));
  const plannedTotal = budgetFunds.reduce((a, f) => a + f.planned, 0);
  const spentOfBudget = budgetFunds.reduce((a, f) => a + f.spent, 0);
  const usedPct = plannedTotal > 0 ? Math.min(100, Math.round((spentOfBudget * 100) / plannedTotal)) : 0;
  const savedPlanned = o.funds.filter((f) => f.kind === "savings").reduce((a, f) => a + f.planned, 0);
  const daysLeft = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate() - today.getUTCDate() + 1;
  const perDay = weekly && weekly.daysInMonth > 0 ? Math.max(0, Math.round(Math.max(0, weekly.leftCents) / Math.max(1, weekly.daysInWeek))) : 0;
  const featured = o.funds.filter((f) => ["fixed", "variable", "leisure"].includes(f.kind) && f.planned > 0);
  const isGroup = active.kind === "group";
  const cardCls = "rounded-card border border-border bg-surface p-4";
  const more = (href: string, label: string) => <Link href={href} className="inline-flex min-h-11 items-center text-sm font-medium text-ink-2">{label} ›</Link>;

  return (
    <section className="flex flex-col gap-4 pt-2">
      {showSummary && (
        <Link href="/resumen-mensual" className={`${cardCls} text-sm`}>
          <span className="font-semibold">{t("summaryReady")}</span>
          <span className="block text-ink-3">{t("summaryCta")}</span>
        </Link>
      )}

      {/* 1 · Tarjeta principal: abre el Plan */}
      {!o.plan.configured || isGroup ? (
        <div className={cardCls}>
          <p className="t-label">{x("Gastado este mes")}</p>
          <p className="money t-display mt-1">{formatMoney(o.spent, "EUR", x.locale)}</p>
          {!o.plan.configured && <div className="mt-4"><SetupPlanCard /></div>}
        </div>
      ) : (
        <div className={`${cardCls} p-5`}>
          <Link href="/plan" aria-label={`${x("Te sobrará a final de mes")}. ${x("Ver plan")}`} className="block">
            <p className="flex items-center justify-between text-sm text-ink-3"><span>{x("Te sobrará a final de mes")}</span><span aria-hidden>›</span></p>
            <AnimatedMoney cents={o.forecastLeftover} className={`money t-display mt-1 block ${o.forecastLeftover < 0 ? "text-over-text" : ""}`} />
            <span className="mt-4 block h-2.5 w-full overflow-hidden rounded-full bg-track" role="img" aria-label={`${usedPct} % ${x("gastado de lo previsto")}`}>
              <span className="block h-full rounded-full" style={{ width: `${usedPct}%`, background: usedPct >= 100 ? "var(--over)" : "var(--accent)" }} />
            </span>
          </Link>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-ink-2">{x("Llevas")} <OptimisticSpent base={spentOfBudget} spaceId={active.id} kind={active.kind} currency="EUR" inline /> {x("de")} <span className="money font-mono text-ink">{formatMoney(plannedTotal, "EUR", x.locale)}</span> {x("previstos")}</p>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4">
            <Link prefetch href="/inicio/prevision" className="inline-flex min-h-11 items-center text-xs text-ink-3 underline-offset-4 hover:underline">{x("Ver desglose")}</Link>
            <Link prefetch href="/inicio/ingresos" className="inline-flex min-h-11 items-center text-xs text-ink-3 underline-offset-4 hover:underline">{x("Ingresos")} {formatMoney(o.income, "EUR", x.locale)}</Link>
          </div>
          <Suspense fallback={null}><ChangeLine seriesP={seriesP} month={o.month} leftover={o.forecastLeftover} locale={x.locale} vsPrev={t("vsPrev")} label={x("Variación frente al mes anterior")} /></Suspense>
        </div>
      )}

      {fromId && splitItems.length > 0 && <PayrollSplitCard fromId={fromId} fromName={accById.get(fromId)?.name ?? ""} items={splitItems} demo={user.app_metadata?.demo === true} />}

      {budgetLeft !== null && <p className={`${cardCls} text-sm text-ink-2`}>{t("budgetLeft", { amount: formatMoney(budgetLeft, "EUR", locale) })}</p>}

      {/* 2 · Esta semana y ahorro */}
      {o.plan.configured && !isGroup && (
        <div className="grid grid-cols-2 gap-3">
          {weekly && (
            <div className={`${cardCls} ${weekly.status === "over" ? "border-over" : weekly.status === "warn" ? "border-warn" : ""}`} role="status">
              <p className="t-label">{weekly.status === "over" ? x("Te has pasado") : x("Esta semana puedes gastar")}</p>
              <p className={`money t-figure mt-1 ${weekly.status === "over" ? "text-over-text" : weekly.status === "warn" ? "text-warn" : ""}`}><AnimatedMoney cents={Math.abs(weekly.leftCents)} /></p>
              <p className="mt-1 text-xs text-ink-3">{weekly.status === "over" ? x("de tu gasto variable") : `≈ ${formatMoney(perDay, "EUR", x.locale)} ${x("al día")}`}</p>
            </div>
          )}
          <Link prefetch href="/inicio/ahorro" className={`${cardCls} block transition-colors hover:bg-surface-2`}>
            <p className="t-label flex justify-between"><span>{x("Ahorro este mes")}</span><span aria-hidden>›</span></p>
            <p className="money t-figure mt-1"><AnimatedMoney cents={savedPlanned} /></p>
            <p className="mt-1 text-xs text-ink-3">{pctText(o.plannedSavingsBp)} {x("de tus ingresos")}</p>
          </Link>
        </div>
      )}

      {/* Tus cuentas */}
      {mineAccounts.length > 0 && (
        <div className={cardCls}>
          <div className="flex items-center justify-between"><h2 className="font-semibold">{x("Tus cuentas")}</h2>{more("/cuentas", x("Ver cuentas"))}</div>
          <p className="money t-figure mt-1">{formatMoney(mineAccounts.reduce((s, a) => s + a.balanceCents, 0), "EUR", x.locale)}</p>
          <ul className="mt-1 divide-y divide-border">
            {mineAccounts.map((a) => (
              <li key={a.id}>
                <Link prefetch href={`/cuentas/${a.id}`} className="flex min-h-12 items-center gap-3 text-sm">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="money shrink-0 font-mono">{formatMoney(a.balanceCents, "EUR", x.locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3 · Próximos cobros */}
      {upcoming.length > 0 && (
        <div className={cardCls}>
          <div className="flex items-center justify-between"><h2 className="font-semibold">{x("Próximos cobros")}</h2>{more("/calendario", x("Calendario"))}</div>
          <ul className="mt-1 flex flex-col gap-2">
            {upcoming.map((c, i) => {
              const cat = catOf.get(c.id ?? "");
              const d = new Date(`${c.date}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", timeZone: "UTC" });
              return (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <CategoryIcon systemName={cat?.system_key} color={cat?.funds?.color} size={36} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.label}</span><span className="block text-xs text-ink-3">{whenLabel(c.date) === d ? d : `${whenLabel(c.date)} · ${d}`}</span></span>
                  <span className="money shrink-0 font-mono">{formatMoney(c.cents, "EUR", x.locale)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 4 · Tu presupuesto */}
      {o.plan.configured && !isGroup && featured.length > 0 && (
        <div className={cardCls}>
          <div className="flex items-center justify-between"><h2 className="font-semibold">{x("Tu presupuesto")}</h2>{more("/plan", x("Ver plan"))}</div>
          <ul className="mt-1 divide-y divide-border">
            {featured.map((f) => (
              <li key={f.fundId}>
                <Link prefetch href={`/inicio/fondo/${f.fundId}`} className="block py-3">
                  <span className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 font-medium"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</span>
                    <span className="money font-mono text-ink-2">{formatMoney(f.spent, "EUR", x.locale)} {x("de")} {formatMoney(f.planned, "EUR", x.locale)}</span></span>
                  <span className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, f.usedBp / 100)}%`, background: f.color }} /></span>
                  {f.status !== "ok" && <span className="sr-only">{f.status === "over" ? x("te has pasado") : x("vas por el 80 %")}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Balance del hogar o del grupo */}
      {balance && active.kind !== "personal" && (
        <Link prefetch href="/balance" className="flex min-h-16 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2">
          <span className="min-w-0">
            <span className="t-label block">{x("Balance")}</span>
            <span className="block truncate font-medium">
              {!transfer ? x("Todo saldado") : transferMine === "owed" ? <>{transfer.from} {x("te debe")} <span className="money font-mono">{formatMoney(transfer.amountCents, "EUR", x.locale)}</span></> : transferMine === "owe" ? <>{x("Debes")} <span className="money font-mono">{formatMoney(transfer.amountCents, "EUR", x.locale)}</span> {x("a")} {transfer.to}</> : <>{transfer.from} → {transfer.to} <span className="money font-mono">{formatMoney(transfer.amountCents, "EUR", x.locale)}</span></>}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-sm text-ink-2">{x("Ver balance")}<span aria-hidden>›</span></span>
        </Link>
      )}

      {active.kind === "personal" && (loans.owedToMe > 0 || loans.iOwe > 0) && (
        <Link href="/prestamos" className="flex min-h-12 items-center justify-between rounded-card border border-border bg-surface px-4 text-sm">
          <span className="money font-mono">{x("Te deben")} {formatMoney(loans.owedToMe, "EUR", x.locale)} · {x("Debes")} {formatMoney(loans.iOwe, "EUR", x.locale)}</span>
          <span aria-hidden className="text-ink-3">›</span>
        </Link>
      )}

      {/* 5 · Últimos movimientos */}
      <div className={cardCls}>
        <div className="flex items-center justify-between"><h2 className="font-semibold">{x("Últimos movimientos")}</h2>{more("/movimientos", x("Ver todos"))}</div>
        {(recent ?? []).length === 0 ? <p className="mt-1 text-sm text-ink-3">{hasData ? x("Aún no hay movimientos este mes.") : t("empty")}</p> : (
          <ul className="mt-1 flex flex-col gap-2">
            {recent!.map((e) => {
              const cat = e.categories as unknown as { system_key: string | null; funds: { color: string } | null } | null;
              return (
                <li key={e.id}>
                  <Link prefetch href={`/movimientos/${e.id}`} className="flex items-center gap-3 text-sm">
                    <CategoryIcon systemName={cat?.system_key} color={cat?.funds?.color} size={36} />
                    <span className="min-w-0 flex-1 truncate"><span className="text-ink-3">{whenLabel(e.spent_at as string)} ·</span> <span className="font-medium">{e.description}</span></span>
                    <span className="money shrink-0 font-mono">{formatMoney(e.amount_cents, e.currency, x.locale)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Gráfica de 6 meses */}
      <Suspense fallback={<div className="h-56 animate-pulse rounded-card border border-border bg-surface" />}><ChartCard seriesP={seriesP} month={o.month} leftover={o.leftover} locale={x.locale} title={t("chartTitle")} /></Suspense>

      {/* 6 · Invitación a la pareja, al final y pequeña */}
      {!user.is_anonymous && active.kind === "personal" && !spaces.some((sp) => sp.kind === "household") && <PartnerInvite />}
      {active.kind === "household" && balance && balance.members.length === 1 && <PartnerInvite spaceId={active.id} dismissible={false} />}
    </section>
  );
}
