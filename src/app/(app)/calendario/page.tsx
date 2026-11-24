import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarMonth, type CalEvent } from "@/components/calendar/CalendarMonth";
import { EmptyState } from "@/components/ui/EmptyState";
import { occurrenceNumber, projectRecurring, rotationPayer, upcomingCharges } from "@/lib/calendar";
import { addMonths, formatMoney, isMonthStart, monthStart } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Calendario" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ mes?: string; vista?: string }> }) {
  const x = await getTx();
  const sp = await searchParams;
  await requireUser();
  const spaces = await listMySpaces();
  const active = await getActiveSpace(spaces);
  if (!active) return null;
  const supabase = await createClient();
  const tabs = (
    <nav aria-label={x("Vista")} className="flex gap-2">
      <Link href="/calendario" aria-current={sp.vista !== "proximos" ? "page" : undefined} className={`min-h-11 rounded-full border px-4 py-2.5 text-sm ${sp.vista !== "proximos" ? "border-accent bg-surface-2" : "border-border text-ink-2"}`}>{x("Mes")}</Link>
      <Link href="/calendario?vista=proximos" aria-current={sp.vista === "proximos" ? "page" : undefined} className={`min-h-11 rounded-full border px-4 py-2.5 text-sm ${sp.vista === "proximos" ? "border-accent bg-surface-2" : "border-border text-ink-2"}`}>{x("Próximos cobros")}</Link>
    </nav>
  );
  if (sp.vista === "proximos") {
    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ data: recAll }, { data: milesAll }] = await Promise.all([
      supabase.from("recurring_expenses").select("id, space_id, description, amount_cents, frequency, day, next_run").eq("active", true),
      supabase.from("goal_milestones").select("space_id, name, due_on, amount_cents").eq("paid", false).gte("due_on", todayIso).lte("due_on", new Date(Date.parse(`${todayIso}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10)),
    ]);
    const list = upcomingCharges(
      (recAll ?? []).map((r) => ({ id: r.id, description: r.description, amountCents: r.amount_cents, frequency: r.frequency, day: r.day, nextRun: r.next_run, spaceId: r.space_id })),
      (milesAll ?? []).map((m) => ({ date: m.due_on as string, label: m.name, cents: m.amount_cents, spaceId: m.space_id })), todayIso, 30);
    const bubble = (id: string) => { const sp2 = spaces.find((s) => s.id === id); return !sp2 ? "—" : sp2.kind === "personal" ? x("Personal") : sp2.name; };
    const total = list.reduce((a, c) => a + c.cents, 0);
    return (
      <section className="flex flex-col gap-4 pt-2">
        <h1 className="text-2xl font-bold">{x("Calendario de pagos")}</h1>
        {tabs}
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-ink-3">{x("Total de los próximos 30 días")}</p>
          <p className="money font-mono text-3xl font-semibold">{formatMoney(total, "EUR", x.locale)}</p>
          <p className="text-xs text-ink-3">{list.length} {list.length === 1 ? x("cobro") : x("cobros")}</p>
        </div>
        {list.length === 0 ? <EmptyState title={x("Sin cobros en los próximos 30 días")} text={x("Cuando añadas gastos fijos, aquí verás los próximos con su fecha y el total del periodo.")} actionLabel={x("Añadir gasto fijo")} href="/plan#gastos-fijos" /> : (
          <ul className="flex flex-col gap-2">
            {list.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium">{c.label}</span>
                  <span className="text-xs text-ink-3">{new Date(`${c.date}T00:00:00Z`).toLocaleDateString(x.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · {bubble(c.spaceId)}{c.kind === "meta" ? ` · ${x("pago de meta")}` : ""}</span></span>
                <span className="money shrink-0 font-mono">{formatMoney(c.cents, "EUR", x.locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  const month = sp.mes && isMonthStart(sp.mes) ? sp.mes : monthStart(new Date());
  const [{ data: rec }, { data: mem }, { data: miles }] = await Promise.all([
    supabase.from("recurring_expenses").select("id, description, amount_cents, frequency, day, next_run, rotation, rotation_pos, categories(system_key, funds(color))").eq("space_id", active.id).eq("active", true),
    supabase.from("space_members").select("id, display_name").eq("space_id", active.id),
    supabase.from("goal_milestones").select("name, due_on, amount_cents, paid").eq("space_id", active.id).eq("paid", false).gte("due_on", month).lt("due_on", addMonths(month, 1)),
  ]);
  const events: CalEvent[] = [
    ...(rec ?? []).flatMap((r) => projectRecurring({ id: r.id, description: r.description, amountCents: r.amount_cents, frequency: r.frequency, day: r.day, nextRun: r.next_run }, month)
      .map((date) => {
        const who = rotationPayer(r.rotation ?? [], r.rotation_pos, occurrenceNumber({ frequency: r.frequency, nextRun: r.next_run }, date));
        const cat = r.categories as unknown as { system_key: string | null; funds: { color: string } | null } | null;
        return { date, label: r.description, cents: r.amount_cents, kind: "fijo" as const, payer: who ? mem?.find((m) => m.id === who)?.display_name : undefined, sysName: cat?.system_key ?? null, color: cat?.funds?.color };
      })),
    ...(miles ?? []).map((m) => ({ date: m.due_on as string, label: m.name, cents: m.amount_cents, kind: "meta" as const, color: "#A78BFA" })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const first = new Date(`${month}T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7; // semana empieza en lunes
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const label = first.toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">{x("Calendario de pagos")}</h1>
      {tabs}
      <div className="flex items-center justify-between">
        <Link href={`/calendario?mes=${addMonths(month, -1)}`} aria-label={x("Mes anterior")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">‹</Link>
        <span className="font-semibold first-letter:uppercase">{label}</span>
        <Link href={`/calendario?mes=${addMonths(month, 1)}`} aria-label={x("Mes siguiente")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">›</Link>
      </div>
      {(rec ?? []).length === 0 && events.length === 0 && (
        <EmptyState title={x("Aún no hay gastos fijos")} text={x("Apunta alquiler, luz o suscripciones una vez y verás aquí cuándo toca pagar cada uno, con aviso antes de que lleguen.")} actionLabel={x("Añadir gasto fijo")} href="/plan#gastos-fijos" />
      )}
      <CalendarMonth label={label} offset={offset} days={days} events={events} todayDay={month === monthStart(new Date()) ? new Date().getUTCDate() : null} />
    </section>
  );
}
