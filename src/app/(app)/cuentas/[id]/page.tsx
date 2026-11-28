import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccountEditor, AdjustBalance } from "@/components/accounts/AccountForms";
import { getTx } from "@/i18n/tx";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { loadAccounts } from "@/server/accounts";
import { listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Cuenta" };

type Line = { lineId: string; date: string; label: string; cents: number; href?: string };

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const [x, user, spaces, supabase] = await Promise.all([getTx(), requireUser(), listMySpaces(), createClient()]);
  const [accounts, { data: exp }, { data: inc }, { data: trIn }, { data: trOut }, { data: adj }] = await Promise.all([
    loadAccounts(supabase, user.id, true),
    supabase.from("expenses").select("id, description, spent_at, amount_base_cents, account_cents").eq("account_id", id).order("spent_at", { ascending: false }).limit(60),
    supabase.from("incomes").select("id, source, received_at, amount_cents, account_cents").eq("account_id", id).order("received_at", { ascending: false }).limit(60),
    supabase.from("account_transfers").select("id, transfer_date, amount_cents, to_amount_cents, note, from_account").eq("to_account", id).order("transfer_date", { ascending: false }).limit(60),
    supabase.from("account_transfers").select("id, transfer_date, amount_cents, note, to_account").eq("from_account", id).order("transfer_date", { ascending: false }).limit(60),
    supabase.from("account_adjustments").select("id, adjust_date, amount_cents, note").eq("account_id", id).order("adjust_date", { ascending: false }).limit(60),
  ]);
  const acc = accounts.find((a) => a.id === id);
  if (!acc) redirect("/cuentas"); // borrada (al vaciar el espacio) o sin acceso
  const nameOf = (aid: string) => accounts.find((a) => a.id === aid)?.name ?? "—";
  const lines: Line[] = [
    ...(exp ?? []).map((e) => ({ lineId: `e${e.id}`, date: e.spent_at as string, label: e.description, cents: -(e.account_cents ?? e.amount_base_cents), href: `/movimientos/${e.id}` })),
    ...(inc ?? []).map((i) => ({ lineId: `i${i.id}`, date: i.received_at as string, label: i.source, cents: i.account_cents ?? i.amount_cents })),
    ...(trIn ?? []).map((t) => ({ lineId: `ti${t.id}`, date: t.transfer_date as string, label: `${x("Traspaso desde")} ${nameOf(t.from_account)}${t.note ? ` · ${t.note}` : ""}`, cents: t.to_amount_cents ?? t.amount_cents })),
    ...(trOut ?? []).map((t) => ({ lineId: `to${t.id}`, date: t.transfer_date as string, label: `${x("Traspaso a")} ${nameOf(t.to_account)}${t.note ? ` · ${t.note}` : ""}`, cents: -t.amount_cents })),
    ...(adj ?? []).map((j) => ({ lineId: `a${j.id}`, date: j.adjust_date as string, label: `${x("Ajuste de saldo")}${j.note ? ` · ${j.note}` : ""}`, cents: j.amount_cents })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
  const demo = user.app_metadata?.demo === true;
  const fmt = (c: number) => formatMoney(c, acc.currency, x.locale);
  const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <section className="flex flex-col gap-4 pt-2">
      <Link href="/cuentas" className="flex min-h-11 items-center self-start text-sm text-ink-2">‹ {x("Mis cuentas")}</Link>
      <h1 className="flex items-center gap-2 text-2xl font-bold"><span aria-hidden className="size-3 rounded-full" style={{ background: acc.color }} />{acc.name}</h1>
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="t-label">{x("Saldo")}</p>
        <p className="money t-display mt-1">{fmt(acc.balanceCents)}</p>
        <p className="mt-1 text-xs text-ink-3">{x("Saldo inicial")} <span className="money font-mono">{fmt(acc.openingCents)}</span> · {dateLabel(acc.openingDate)}</p>
        {acc.mine && !acc.archived && (
          <div className="mt-3 flex flex-wrap gap-2">
            <AdjustBalance accountId={acc.id} balanceCents={acc.balanceCents} demo={demo} />
            <AccountEditor spaces={spaces} account={acc} label={x("Editar")} demo={demo} variant="plain" />
            <Link href="/traspaso" className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-semibold">{x("Traspaso")}</Link>
          </div>
        )}
      </div>
      <h2 className="font-semibold">{x("Movimientos")}</h2>
      {lines.length === 0 ? <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-3">{x("Aún no hay movimientos en esta cuenta.")}</p> : (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => {
            const row = (
              <>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{l.label}</span><span className="block text-xs text-ink-3">{dateLabel(l.date)}</span></span>
                <span className="money shrink-0 font-mono">{l.cents > 0 ? "+" : ""}{fmt(l.cents)}</span>
              </>
            );
            return <li key={l.lineId}>{l.href ? <Link href={l.href} className="flex min-h-14 items-center gap-3 rounded-card border border-border bg-surface px-4">{row}</Link> : <div className="flex min-h-14 items-center gap-3 rounded-card border border-border bg-surface px-4">{row}</div>}</li>;
          })}
        </ul>
      )}
    </section>
  );
}
