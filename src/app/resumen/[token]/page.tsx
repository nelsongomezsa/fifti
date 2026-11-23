import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { CopyButton } from "@/components/ui/CopyButton";
import { formatMoney, simplifyDebts } from "@/lib/money";
import { RULES, hitIp } from "@/lib/security/rate-limit";
import { hashToken, isValidToken } from "@/lib/security/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Resumen", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Data = {
  space_name: string; emoji: string | null; currency: string; total_cents: number;
  members: { id: string; name: string; paid: number; owed: number; sent: number; received: number }[];
};

/** Resumen público de solo lectura: totales y quién paga a quién. Sin conceptos, fechas ni detalles de gastos. */
export default async function SummaryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isValidToken(token)) notFound();
  if (!(await hitIp(RULES.publicSummary))) notFound();
  const { data } = await createAdminClient().rpc("public_summary_data", { p_token_hash: hashToken(token) });
  const d = data as Data | null;
  if (!d) notFound();

  const ids = d.members.map((m) => m.id);
  const net = Object.fromEntries(d.members.map((m) => [m.id, m.paid - m.owed + m.sent - m.received]));
  const transfers = simplifyDebts(net);
  const name = (id: string) => d.members.find((m) => m.id === id)?.name ?? "—";
  const fmt = (c: number) => formatMoney(c, d.currency);
  const text = `${d.space_name}: total ${fmt(d.total_cents)}. ` + (transfers.length ? transfers.map((t) => `${name(t.from)} paga ${fmt(t.amountCents)} a ${name(t.to)}`).join(". ") + "." : "Todo saldado.");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-8">
      <Logo height={26} />
      <div>
        <p className="text-sm text-ink-3">Resumen</p>
        <h1 className="text-2xl font-bold">{d.emoji ? `${d.emoji} ` : ""}{d.space_name}</h1>
        <p className="money mt-1 font-mono text-3xl">{fmt(d.total_cents)}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {d.members.map((m) => (
          <li key={m.id} className="flex justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
            <span>{m.name}</span><span className="money font-mono">{fmt(net[m.id] ?? 0)}</span>
          </li>
        ))}
      </ul>
      <h2 className="text-lg font-semibold">Quién paga a quién</h2>
      {ids.length === 0 || transfers.length === 0 ? <p className="text-ink-2">Todo saldado.</p> : (
        <ul className="flex flex-col gap-2">{transfers.map((t) => (
          <li key={`${t.from}-${t.to}`} className="flex justify-between rounded-card border border-border bg-surface px-4 py-3">
            <span>{name(t.from)} → {name(t.to)}</span><span className="money font-mono">{fmt(t.amountCents)}</span>
          </li>))}</ul>
      )}
      <CopyButton text={text} label="Compartir resumen" shareTitle={`Resumen de ${d.space_name}`} />
    </main>
  );
}
