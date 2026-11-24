import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { SetupPlanCard } from "@/components/plan/SetupPlanCard";
import { OptimisticLeftover } from "@/components/expense/optimistic";
import { getLocale, getTranslations } from "next-intl/server";
import { SpendChart } from "@/components/charts/SpendChart";
import { dailyBudgetLeft } from "@/lib/fx";
import { formatMoney, monthStart } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { loadSpaceBalance } from "@/server/balance";
import { loadOverview } from "@/server/overview";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Inicio" };

export default async function HomePage() {
  const [x, user, spaces, t, locale] = await Promise.all([getTx(), requireUser(), listMySpaces(), getTranslations("home"), getLocale()]);
  const active = await getActiveSpace(spaces);
  if (!active) return null;
  const supabase = await createClient();

  // Resumen, saldo del grupo y presupuesto del día no dependen entre sí: se piden a la vez.
  const [o, balance, budget] = await Promise.all([
    loadOverview(supabase, active.id, active.kind, undefined, undefined, x.locale),
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
  ]);
  const monthName = new Date(`${o.month}T00:00:00Z`).toLocaleDateString(locale, { month: "long", timeZone: "UTC" });
  const pctText = (bp: number) => `${(bp / 100).toFixed(0)} %`;
  const hasData = o.income > 0 || o.spent > 0;

  let transfer: { from: string; to: string; amountCents: number } | null = null;
  if (balance) {
    const me = balance.members.find((m) => m.user_id === user.id);
    const tr = balance.transfers.find((q) => q.from === me?.id || q.to === me?.id) ?? balance.transfers[0];
    if (tr) transfer = { from: balance.members.find((m) => m.id === tr.from)?.display_name ?? "—", to: balance.members.find((m) => m.id === tr.to)?.display_name ?? "—", amountCents: tr.amountCents };
  }
  const budgetLeft: number | null = budget;
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

      {!o.plan.configured ? (
        <>
          <div>
            <p className="text-sm text-ink-3">{x("Gastado este mes")}</p>
            <p className="money font-mono text-5xl font-semibold">{formatMoney(o.spent, "EUR", x.locale)}</p>
          </div>
          <SetupPlanCard />
      <div className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm text-ink-3">{t("chartTitle")}</h2>
        <SpendChart data={o.series} currency="EUR" />
      </div>
        </>
      ) : (
        <>
      <div>
        <p className="text-sm text-ink-3">{t("leftIn", { month: monthName })}</p>
        <OptimisticLeftover base={o.leftover} spaceId={active.id} kind={active.kind} currency="EUR" />
        <p className="money mt-1 font-mono text-sm text-ink-2" aria-label={x("Variación frente al mes anterior")}>
          {o.change.deltaCents >= 0 ? "+" : ""}{formatMoney(o.change.deltaCents, "EUR", x.locale)} {t("vsPrev")}
          {o.change.percentBp !== null && ` (${o.change.percentBp >= 0 ? "+" : ""}${pctText(o.change.percentBp)})`}
        </p>
      </div>

      {budgetLeft !== null && (
        <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-2">
          {t("budgetLeft", { amount: formatMoney(budgetLeft, "EUR", locale) })}
        </p>
      )}

      <dl className="grid grid-cols-3 gap-2">
        {[[t("income"), formatMoney(o.income, "EUR", locale)], [t("savingsRate"), pctText(o.savingsBp)], [t("forecast"), formatMoney(o.forecastLeftover, "EUR", locale)]].map(([k, v]) => (
          <div key={k} className="@container min-w-0 rounded-card border border-border bg-surface p-3">
            <dt className="text-xs text-ink-3">{k}</dt>
            <dd className="money mt-1 whitespace-nowrap font-mono" style={{ fontSize: "clamp(0.68rem, 15cqw, 1rem)" }}>{v}</dd>
          </div>
        ))}
      </dl>

      {!hasData && (
        <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{t("empty")}</p>
      )}

      <div className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm text-ink-3">{t("chartTitle")}</h2>
        <SpendChart data={o.series} currency="EUR" />
      </div>

        </>
      )}

      {transfer && (
        <div className="flex items-center justify-between rounded-card border border-border bg-surface p-4">
          <p><span className="block text-xs text-ink-3">{t("pending")}</span>{transfer.from} → {transfer.to} <span className="money font-mono">{formatMoney(transfer.amountCents, "EUR", x.locale)}</span></p>
          <Link href="/balance" className="min-h-11 rounded-full bg-accent px-5 py-2.5 font-semibold text-on-accent">{t("settle")}</Link>
        </div>
      )}

      {o.plan.configured && (
      <div className="rounded-card border border-border bg-surface">
        <h2 className="px-4 pt-4 text-sm text-ink-3">{t("funds")}</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">{x("Uso de cada fondo este mes")}</caption>
          <tbody>
            {o.funds.filter((f) => f.planned > 0).map((f) => (
              <tr key={f.fundId} className="border-t border-border first:border-t-0">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, f.usedBp / 100)}%`, background: f.status === "over" ? "var(--over)" : f.status === "warn" ? "var(--warn)" : f.color }} /></span>
                </td>
                <td className={`money px-4 py-3 text-right font-mono ${f.status === "over" ? "text-over-text" : "text-ink-2"}`}>{Math.round(f.usedBp / 100)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
        {o.funds.every((f) => f.planned === 0) && <p className="px-4 pb-4 pt-2 text-sm text-ink-3">{t("definePlan")}</p>}
      </div>
      )}
    </section>
  );
}
