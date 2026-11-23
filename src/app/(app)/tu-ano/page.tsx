import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { YearImage } from "@/components/ui/YearImage";
import { fillSeries, formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Tu año en Fifti" };

const MONTH = (i: number, locale: string) => new Date(Date.UTC(2000, i, 1)).toLocaleDateString(locale, { month: "long", timeZone: "UTC" });

export default async function YearPage() {
  const x = await getTx();
  const user = await requireUser();
  if (user.is_anonymous) return <p className="pt-4 text-ink-2">{x("Crea una cuenta para ver tu año.")}</p>;
  const supabase = await createClient();
  const year = new Date().getUTCFullYear();
  const from = `${year}-01-01`;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}-01`);

  const { data: personal } = await supabase.from("spaces").select("id").eq("kind", "personal").maybeSingle();
  if (!personal) return null;
  const [{ data: spend }, { data: inc }, { data: mir }, { data: exp }, { data: mirrors }, { data: funds }, { data: cats }, { data: mem }, { data: groups }, { data: yearExpenses }, { data: allSpaces }] = await Promise.all([
    supabase.rpc("monthly_spend", { p_space: personal.id, p_from: from }),
    supabase.rpc("monthly_income", { p_space: personal.id, p_from: from }),
    supabase.rpc("monthly_mirror", { p_from: from }),
    supabase.from("expenses").select("category_id, amount_base_cents").eq("space_id", personal.id).gte("spent_at", from).limit(5000),
    supabase.from("personal_mirror").select("fund_id, amount_cents").gte("spent_at", from).limit(5000),
    supabase.from("funds").select("id, name").eq("space_id", personal.id),
    supabase.from("categories").select("id, fund_id").eq("space_id", personal.id),
    supabase.from("space_members").select("space_id, user_id"),
    supabase.from("spaces").select("id, kind, archived_at").eq("kind", "group").not("archived_at", "is", null).gte("archived_at", from),
    supabase.from("expenses").select("space_id").gte("spent_at", from).limit(5000),
    supabase.from("spaces").select("id, name, kind"),
  ]);

  const s = fillSeries(months, (spend ?? []) as never), m = fillSeries(months, (mir ?? []) as never), i = fillSeries(months, (inc ?? []) as never);
  const totalSpent = s.reduce((a, b, k) => a + b + m[k]!, 0);
  const net = months.map((_, k) => i[k]! - s[k]! - m[k]!);
  const bestIdx = net.every((v) => v === 0) ? -1 : net.indexOf(Math.max(...net));
  const catFund = new Map((cats ?? []).map((c) => [c.id, c.fund_id]));
  const byFund = new Map<string, number>();
  for (const e of exp ?? []) { const f = e.category_id ? catFund.get(e.category_id) : undefined; if (f) byFund.set(f, (byFund.get(f) ?? 0) + e.amount_base_cents); }
  for (const r of mirrors ?? []) byFund.set(r.fund_id, (byFund.get(r.fund_id) ?? 0) + r.amount_cents);
  const topFundId = [...byFund.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topFund = funds?.find((f) => f.id === topFundId)?.name ?? "—";
  const myGroups = new Set((mem ?? []).filter((x) => x.user_id === user.id).map((x) => x.space_id));
  const perSpace = new Map<string, number>();
  for (const e of yearExpenses ?? []) perSpace.set(e.space_id, (perSpace.get(e.space_id) ?? 0) + 1);
  const topSpaceId = [...perSpace.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topSpace = allSpaces?.find((sp) => sp.id === topSpaceId);
  const topBubble = topSpace ? (topSpace.kind === "personal" ? x("Personal") : topSpace.name) : "—";
  const closed = (groups ?? []).filter((g) => myGroups.has(g.id)).length;

  const cards = [
    { title: x("Lo que más gastaste"), value: topFund },
    { title: x("Tu mes de más ahorro"), value: bestIdx >= 0 ? MONTH(bestIdx, x.locale) : "—" },
    { title: x("Planes cerrados"), value: String(closed) },
    { title: x("Tu burbuja más activa"), value: topBubble },
  ];

  return (
    <section className="flex flex-col gap-4 pt-2">
      <Link href="/mas" className="text-sm text-ink-2">{x("‹ Más")}</Link>
      <h1 className="text-2xl font-bold">{x("Tu año")}{" "}{year} {x("en Fifti")}</h1>
      <p className="text-sm text-ink-3">{x("Total gastado:")}{" "}<span className="money font-mono text-ink">{formatMoney(totalSpent, "EUR", x.locale)}</span> {x("(solo lo ves tú). La imagen para compartir no incluye importes.")}</p>
      <ul className="grid gap-3">
        {cards.map((c) => (
          <li key={c.title} className="rounded-card border border-border bg-surface p-4">
            <p className="text-sm text-ink-3">{c.title}</p>
            <p className="mt-1 text-2xl font-bold capitalize">{c.value}</p>
          </li>
        ))}
      </ul>
      <YearImage year={year} cards={cards} />
    </section>
  );
}
