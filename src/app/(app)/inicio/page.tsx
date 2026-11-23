import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
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
  const x = await getTx();
  const user = await requireUser();
  const spaces = await listMySpaces();
  const active = await getActiveSpace(spaces);
  if (!active) return null;
  const supabase = await createClient();
  const t = await getTranslations("home");
  const locale = await getLocale();
  const o = await loadOverview(supabase, active.id, active.kind, undefined, undefined, x.locale);
  const monthName = new Date(`${o.month}T00:00:00Z`).toLocaleDateString(locale, { month: "long", timeZone: "UTC" });
  const pctText = (bp: number) => `${(bp / 100).toFixed(0)} %`;
  const hasData = o.income > 0 || o.spent > 0;

  let transfer: { from: string; to: string; amountCents: number } | null = null;
  if (active.kind !== "personal") {
    const b = await loadSpaceBalance(supabase, active.id);
    const me = b.members.find((m) => m.user_id === user.id);
    const t = b.transfers.find((x) => x.from === me?.id || x.to === me?.id) ?? b.transfers[0];
    if (t) transfer = { from: b.members.find((m) => m.id === t.from)?.display_name ?? "—", to: b.members.find((m) => m.id === t.to)?.display_name ?? "—", amountCents: t.amountCents };
  }
  let budgetLeft: number | null = null;
  if (active.kind === "group") {
    const { data: sp } = await supabase.from("spaces").select("daily_budget_cents").eq("id", active.id).maybeSingle();
    if (sp?.daily_budget_cents) {
      const day = new Date().toISOString().slice(0, 10);
      const [{ data: ex }, { count }] = await Promise.all([
        supabase.from("expenses").select("amount_base_cents").eq("space_id", active.id).eq("spent_at", day).eq("paid_from", "member"),
        supabase.from("space_members").select("id", { count: "exact", head: true }).eq("space_id", active.id),
      ]);
      budgetLeft = dailyBudgetLeft(sp.daily_budget_cents, count ?? 1, (ex ?? []).reduce((a, e) => a + e.amount_base_cents, 0));
    }
  }
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

      <div>
        <p className="text-sm text-ink-3">{t("leftIn", { month: monthName })}</p>
        <p className={`money font-mono text-5xl font-semibold ${o.leftover < 0 ? "text-over-text" : ""}`}>{formatMoney(o.leftover, "EUR", x.locale)}</p>
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
          <div key={k} className="rounded-card border border-border bg-surface p-3">
            <dt className="text-xs text-ink-3">{k}</dt>
            <dd className="money mt-1 font-mono text-base">{v}</dd>
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

      {transfer && (
        <div className="flex items-center justify-between rounded-card border border-border bg-surface p-4">
          <p><span className="block text-xs text-ink-3">{t("pending")}</span>{transfer.from} → {transfer.to} <span className="money font-mono">{formatMoney(transfer.amountCents, "EUR", x.locale)}</span></p>
          <Link href="/balance" className="min-h-11 rounded-full bg-accent px-5 py-2.5 font-semibold text-on-accent">{t("settle")}</Link>
        </div>
      )}

      <div className="rounded-card border border-border bg-surface">
        <h2 className="px-4 pt-4 text-sm text-ink-3">{t("funds")}</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">{x("Uso de cada fondo este mes")}</caption>
          <tbody>
            {o.funds.filter((f) => f.planned > 0 || f.spent > 0).map((f) => (
              <tr key={f.fundId} className="border-t border-border first:border-t-0">
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, f.usedBp / 100)}%`, background: f.status === "over" ? "var(--over)" : f.status === "warn" ? "var(--tangerine)" : f.color }} /></span>
                </td>
                <td className={`money px-4 py-3 text-right font-mono ${f.status === "over" ? "text-over-text" : "text-ink-2"}`}>{Math.round(f.usedBp / 100)} %</td>
              </tr>
            ))}
          </tbody>
        </table>
        {o.funds.every((f) => f.planned === 0 && f.spent === 0) && <p className="px-4 pb-4 pt-2 text-sm text-ink-3">{t("definePlan")}</p>}
      </div>
    </section>
  );
}
