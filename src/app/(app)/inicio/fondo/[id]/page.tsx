import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney, summarizeFund } from "@/lib/money";
import { displayName } from "@/lib/system-names";
import { uuidSchema } from "@/lib/validation/spaces";
import { detailContext } from "@/server/inicio-detail";
import { loadMirrorByFund, loadPlan } from "@/server/plan";

export const metadata: Metadata = { title: "Fondo" };

type Line = { id: string; date: string; label: string; cents: number; categoryId: string | null; from?: string };

export default async function FundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { x, active, supabase, month, monthName } = await detailContext();
  const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const personal = active.kind === "personal";

  const { data: fund } = await supabase.from("funds").select("id, name, color, kind, system_key").eq("id", id).eq("space_id", active.id).maybeSingle();
  if (!fund) notFound();
  const { data: cats } = await supabase.from("categories").select("id, name, system_key").eq("fund_id", id).eq("space_id", active.id);
  const catIds = (cats ?? []).map((c) => c.id);
  const isDaily = fund.system_key === "fund.daily";

  const [plan, { data: exp }, { data: mir }] = await Promise.all([
    (async () => loadPlan(supabase, active.id, month, personal ? await loadMirrorByFund(supabase, month) : {}, { uncategorizedToDaily: personal }))(),
    catIds.length || (personal && isDaily)
      ? supabase.from("expenses").select("id, description, amount_base_cents, spent_at, category_id").eq("space_id", active.id).gte("spent_at", month).lt("spent_at", nextMonth)
          .or([catIds.length ? `category_id.in.(${catIds.join(",")})` : "", personal && isDaily ? "category_id.is.null" : ""].filter(Boolean).join(",")).order("spent_at", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] }),
    personal ? supabase.from("personal_mirror").select("source_expense_id, label, amount_cents, spent_at").eq("fund_id", id).eq("enabled", true).gte("spent_at", month).lt("spent_at", nextMonth).order("spent_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
  ]);

  const a = plan.allocations[id];
  const row = summarizeFund(id, (a?.planned ?? 0) + (a?.carry ?? 0), plan.spentByFund[id] ?? 0);
  const name = displayName(x, fund.name, fund.system_key);
  const fmt = (c: number) => formatMoney(c, "EUR", x.locale);
  const lines: Line[] = [
    ...(exp ?? []).map((e) => ({ id: e.id, date: e.spent_at as string, label: e.description || x("Sin concepto"), cents: e.amount_base_cents as number, categoryId: e.category_id as string | null })),
    ...(mir ?? []).map((m) => ({ id: m.source_expense_id as string, date: m.spent_at as string, label: (m.label as string) || x("Gasto compartido"), cents: m.amount_cents as number, categoryId: null, from: x("De una burbuja compartida") })),
  ].sort((p, q) => q.date.localeCompare(p.date));
  const byCat = new Map<string | null, number>();
  for (const l of lines) byCat.set(l.categoryId, (byCat.get(l.categoryId) ?? 0) + l.cents);
  const catName = (cid: string | null) => { const c = cats?.find((k) => k.id === cid); return c ? displayName(x, c.name, c.system_key) : cid === null && isDaily ? x("Sin categoría") : x("Gastos compartidos"); };
  const tone = fund.kind === "savings" ? "text-ink" : row.status === "over" ? "text-over-text" : row.status === "warn" ? "text-warn" : "text-ink";

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/inicio" className="min-h-11 self-start text-sm text-ink-2">{x("‹ Inicio")}</Link>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><span aria-hidden className="size-3 rounded-full" style={{ background: fund.color }} />{name}</h1>
        <p className="text-sm text-ink-3 first-letter:uppercase">{monthName}</p>
      </div>

      <div className="rounded-card border border-border bg-surface p-4">
        <p className="flex items-baseline justify-between"><span className="text-sm text-ink-3">{x("Previsto")}</span><span className="money font-mono">{fmt(row.planned)}</span></p>
        <p className="mt-1 flex items-baseline justify-between"><span className="text-sm text-ink-3">{x("Real")}</span><span className="money font-mono">{fmt(row.spent)}</span></p>
        <p className="mt-1 flex items-baseline justify-between"><span className="text-sm text-ink-3">{row.remaining >= 0 ? x("Te queda") : x("Te has pasado")}</span><span className={`money font-mono text-xl font-semibold ${tone}`}>{fmt(Math.abs(row.remaining))}</span></p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-track" role="img" aria-label={`${Math.round(row.usedBp / 100)} %`}>
          <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, row.usedBp / 100))}%`, background: fund.color }} />
        </div>
        <p className={`money mt-1 text-right font-mono text-sm ${tone}`}>{Math.round(row.usedBp / 100)} %</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{x("Categorías")}</h2>
        {(cats ?? []).length === 0 && byCat.size === 0 ? <p className="text-sm text-ink-3">{x("Este fondo aún no tiene categorías.")}</p> : (
          <ul className="flex flex-col gap-2">
            {[...(cats ?? []).map((c) => c.id as string | null), ...[...byCat.keys()].filter((k) => k === null || !(cats ?? []).some((c) => c.id === k))].map((cid) => (
              <li key={String(cid)} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
                <span>{catName(cid)}</span><span className="money font-mono text-ink-2">{fmt(byCat.get(cid) ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{x("Movimientos del mes")}</h2>
        {lines.length === 0 ? <p className="text-sm text-ink-3">{x("Todavía no hay movimientos en este fondo este mes.")}</p> : (
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={`${l.id}-${l.date}-${l.cents}`}>
                <Link href={`/movimientos/${l.id}`} className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 text-sm transition-colors hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
                  <span className="min-w-0"><span className="block truncate font-medium">{l.label}</span>
                    <span className="text-xs text-ink-3">{new Date(`${l.date}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", timeZone: "UTC" })} · {l.from ?? catName(l.categoryId)}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><span className="money font-mono">{fmt(l.cents)}</span><span aria-hidden className="text-ink-3">›</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
