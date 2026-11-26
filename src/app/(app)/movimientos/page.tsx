import { loadAccounts } from "@/server/accounts";
import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import type { Metadata } from "next";
import Link from "next/link";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { SwipeRow } from "@/components/movements/SwipeRow";
import { MovementFilters } from "@/components/movements/MovementFilters";
import { PendingExpenseRows } from "@/components/expense/optimistic";
import { ArrowRightLeft, Users, Wallet } from "lucide-react";
import { addMonths, formatMoney, isMonthStart, monthStart } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Movimientos" };

type SP = { tipo?: string; mes?: string; cat?: string; fondo?: string; persona?: string; pago?: string; tag?: string; q?: string; cuenta?: string };
const esc = (s: string) => s.replace(/[\\%_,()]/g, " ").trim().slice(0, 50);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [x, sp, user, spaces] = await Promise.all([getTx(), searchParams, requireUser(), listMySpaces()]);
  const active = await getActiveSpace(spaces);
  if (!active) return null;
  const supabase = await createClient();

  const month = sp.mes && isMonthStart(sp.mes) ? sp.mes : monthStart(new Date());
  const next = addMonths(month, 1);
  const monthLabel = new Date(`${month}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });

  let q = supabase
    .from("expenses")
    .select((`id, description, spent_at, amount_cents, currency, category_id, is_private, created_by_member, expense_splits(member_id, amount_cents), expense_tags(tags(name))${sp.pago && uuid.test(sp.pago) ? ", expense_payers!inner(member_id)" : ""}${sp.fondo && uuid.test(sp.fondo) ? ", categories!inner(fund_id)" : ""}`) as "id, description, spent_at, amount_cents, currency, category_id, is_private, created_by_member, expense_splits(member_id, amount_cents), expense_tags(tags(name))")
    .eq("space_id", active.id).gte("spent_at", month).lt("spent_at", next)
    .order("spent_at", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (sp.cat && uuid.test(sp.cat)) q = q.eq("category_id", sp.cat);
  if (sp.persona && uuid.test(sp.persona)) q = q.eq("created_by_member", sp.persona);
  if (sp.pago && uuid.test(sp.pago)) q = q.eq("expense_payers.member_id", sp.pago);
  if (sp.fondo && uuid.test(sp.fondo)) q = q.eq("categories.fund_id", sp.fondo);
  if (sp.cuenta === "none") q = q.is("account_id", null);
  else if (sp.cuenta && uuid.test(sp.cuenta)) q = q.eq("account_id", sp.cuenta);
  if (sp.q && esc(sp.q)) q = q.ilike("description", `%${esc(sp.q)}%`);
  // Todas las consultas son independientes: una sola ronda de red
  const [{ data: members }, { data: cats }, { data: fundColors }, { data: expenses }, { data: privates }, { data: mirrors }, accountList, { data: incomeRows }, { data: transferRows }, { data: contribRows }] = await Promise.all([
    supabase.from("space_members").select("id, user_id, display_name").eq("space_id", active.id),
    supabase.from("categories").select("id, name, system_key, fund_id").eq("space_id", active.id),
    supabase.from("funds").select("id, name, color, system_key").eq("space_id", active.id).order("position"),
    q,
    supabase.from("expense_private_details").select("expense_id, description"),
    active.kind === "personal"
      ? supabase.from("personal_mirror").select("id, label, amount_cents, spent_at").eq("enabled", true).gte("spent_at", month).lt("spent_at", next).order("spent_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; label: string; amount_cents: number; spent_at: string }[] }),
    user.is_anonymous ? Promise.resolve([]) : loadAccounts(supabase, user.id),
    supabase.from("incomes").select("id, source, received_at, amount_cents, account_id").eq("space_id", active.id).gte("received_at", month).lt("received_at", next),
    user.is_anonymous ? Promise.resolve({ data: [] as { id: string; transfer_date: string; amount_cents: number; note: string | null; from_account: string; to_account: string }[] }) : supabase.from("account_transfers").select("id, transfer_date, amount_cents, note, from_account, to_account").gte("transfer_date", month).lt("transfer_date", next),
    active.kind === "household" ? supabase.from("contributions").select("id, member_id, paid_cents, paid_at").eq("space_id", active.id).eq("month", month).gt("paid_cents", 0) : Promise.resolve({ data: [] as { id: string; member_id: string; paid_cents: number; paid_at: string | null }[] }),
  ]);
  const accountOpts = accountList.map((a) => ({ id: a.id, name: a.name }));
  const me = members?.find((m) => m.user_id === user.id);
  const priv = new Map((privates ?? []).map((p) => [p.expense_id, p.description]));
  type Row = NonNullable<typeof expenses>[number];
  const tagOf = (e: Row) => ((e.expense_tags as unknown as { tags: { name: string } | null }[]) ?? []).map((t) => t.tags?.name).filter(Boolean) as string[];
  const tag = sp.tag?.toLowerCase().replace(/^#/, "");
  const tipo = sp.tipo === "gastos" || sp.tipo === "ingresos" || sp.tipo === "traspasos" ? sp.tipo : "";
  const onlyExpenseFilters = !!(sp.cat || sp.fondo || sp.persona || sp.pago || tag);
  const needle = sp.q ? esc(sp.q).toLowerCase() : "";
  const rows = tipo && tipo !== "gastos" ? [] : (expenses ?? []).filter((e) => !tag || tagOf(e).includes(tag));
  const accById = new Map(accountList.map((a) => [a.id, a]));
  const memberName = new Map((members ?? []).map((m) => [m.id, m.display_name]));
  const byCuenta = (id: string | null) => !sp.cuenta || (sp.cuenta === "none" ? !id : id === sp.cuenta);
  const incomes = (tipo && tipo !== "ingresos") || onlyExpenseFilters ? [] : (incomeRows ?? []).filter((i) => byCuenta(i.account_id) && (!needle || i.source.toLowerCase().includes(needle)));
  const contribs = (tipo && tipo !== "ingresos") || onlyExpenseFilters || sp.cuenta ? [] : (contribRows ?? []).filter((c) => !needle || "aportación".includes(needle));
  const transfers = (tipo && tipo !== "traspasos") || onlyExpenseFilters ? [] : (transferRows ?? []).filter((t) => {
    const inSpace = [t.from_account, t.to_account].some((id) => accById.get(id)?.spaceId === active.id);
    return inSpace && (!sp.cuenta || (sp.cuenta !== "none" && (t.from_account === sp.cuenta || t.to_account === sp.cuenta))) && (!needle || (t.note ?? "").toLowerCase().includes(needle) || "traspaso".includes(needle));
  });
  const catName = new Map((cats ?? []).map((c) => [c.id, displayName(x, c.name, c.system_key)]));
  const entradas = incomes.reduce((a, i) => a + i.amount_cents, 0) + contribs.reduce((a, c) => a + c.paid_cents, 0);
  const salidas = rows.reduce((a, e) => a + e.amount_cents, 0);
  const catInfo = new Map((cats ?? []).map((c) => [c.id, { sysName: c.system_key as string | null, color: (fundColors ?? []).find((f) => f.id === c.fund_id)?.color ?? "#9AA3AF" }]));
  const todayIso = new Date().toISOString().slice(0, 10), yesterdayIso = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const dayLabel = (iso: string) => (iso === todayIso ? x("Hoy") : iso === yesterdayIso ? x("Ayer") : new Date(`${iso}T00:00:00Z`).toLocaleDateString(x.locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }));
  type Other = { id: string; kind: "income" | "transfer" | "contribution"; date: string; cents: number; title: string; sub: string; href?: string };
  const others: Other[] = [
    ...incomes.map((i) => ({ id: `i${i.id}`, kind: "income" as const, date: i.received_at as string, cents: i.amount_cents, title: i.source, sub: [x("Ingreso"), accById.get(i.account_id ?? "")?.name].filter(Boolean).join(" · "), href: "/inicio/ingresos" })),
    ...contribs.map((c) => ({ id: `c${c.id}`, kind: "contribution" as const, date: (c.paid_at ?? month) as string, cents: c.paid_cents, title: `${x("Aportación de")} ${memberName.get(c.member_id) ?? "—"}`, sub: x("Aportación al hogar") })),
    ...transfers.map((t) => ({ id: `t${t.id}`, kind: "transfer" as const, date: t.transfer_date as string, cents: t.amount_cents, title: `${accById.get(t.from_account)?.name ?? "—"} → ${accById.get(t.to_account)?.name ?? "—"}`, sub: [x("Traspaso"), t.note].filter(Boolean).join(" · "), href: `/cuentas/${t.from_account}` })),
  ];
  const dayKeys = [...new Set([...rows.map((e) => e.spent_at as string), ...others.map((o) => o.date)])].sort((a, b) => b.localeCompare(a));
  const total = rows.length + others.length;
  const href = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/movimientos?${p.toString()}`;
  };

  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">{x("Movimientos")}</h1>

      <div className="flex items-center justify-between">
        <Link prefetch href={href({ mes: addMonths(month, -1) })} aria-label={x("Mes anterior")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">‹</Link>
        <span className="font-semibold first-letter:uppercase">{monthLabel}</span>
        <Link prefetch href={href({ mes: next })} aria-label={x("Mes siguiente")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">›</Link>
      </div>

      <MovementFilters month={month} q={sp.q} cat={sp.cat} fondo={sp.fondo} persona={sp.persona} pago={sp.pago} tag={sp.tag} cuenta={sp.cuenta} tipo={tipo}
        accounts={user.is_anonymous ? [] : accountOpts}
        funds={(fundColors ?? []).map((f) => ({ id: f.id, name: displayName(x, f.name, f.system_key) }))}
        cats={(cats ?? []).map((c) => ({ id: c.id, name: displayName(x, c.name, c.system_key) }))}
        members={active.kind !== "personal" ? (members ?? []).map((m) => ({ id: m.id, name: m.display_name })) : null} />

      <p className="grid grid-cols-2 gap-2 text-sm" aria-label={x("Resumen del mes")}>
        <span className="rounded-card border border-border bg-surface px-3 py-2"><span className="block text-ink-3">{x("Entradas")}</span><span className="money font-mono text-base text-lime">+{formatMoney(entradas, "EUR", x.locale)}</span></span>
        <span className="rounded-card border border-border bg-surface px-3 py-2"><span className="block text-ink-3">{x("Salidas")}</span><span className="money font-mono text-base">−{formatMoney(salidas, "EUR", x.locale)}</span></span>
      </p>

      <PendingExpenseRows spaceId={active.id} month={month} />
      {(mirrors ?? []).length > 0 && !tipo && (
        <ul className="flex flex-col gap-2" aria-label={x("Tu parte de gastos de grupo")}>
          {mirrors!.map((mr) => (
            <li key={mr.id} className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-dashed border-border px-4 py-3">
              <span><span className="block font-medium">{x("Tu parte de")}{" "}{mr.label}</span><span className="text-sm text-ink-3">{mr.spent_at} {x("· reflejo de grupo")}</span></span>
              <span className="money font-mono">−{formatMoney(mr.amount_cents, "EUR", x.locale)}</span>
            </li>
          ))}
        </ul>
      )}
      {total === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface p-6 text-center">
          <p className="font-semibold">{x("Aún no hay movimientos")}</p>
          <p className="text-sm text-ink-2">{x("Aquí verás cada gasto, ingreso y traspaso del mes, agrupado por día. Apunta el primero en segundos.")}</p>
          <Link href="/nuevo" className="inline-flex min-h-12 items-center rounded-full bg-accent px-6 font-semibold text-on-accent">{x("Añadir el primero")}</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {dayKeys.map((day) => {
            const list = rows.filter((e) => e.spent_at === day);
            const rest = others.filter((o) => o.date === day);
            const net = rest.reduce((a, o) => a + (o.kind === "transfer" ? 0 : o.cents), 0) - list.reduce((a, e) => a + e.amount_cents, 0);
            return (
              <section key={day} aria-label={dayLabel(day)}>
                <h2 className="mb-2 flex items-baseline justify-between px-1 text-sm text-ink-3"><span className="first-letter:uppercase">{dayLabel(day)}</span><span className="money font-mono">{net > 0 ? "+" : net < 0 ? "−" : ""}{formatMoney(Math.abs(net), "EUR", x.locale)}</span></h2>
                <ul className="flex flex-col gap-2">
                  {rest.map((o) => {
                    const body = (
                      <>
                        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: o.kind === "transfer" ? "#A78BFA2e" : "#C8F0602e", color: o.kind === "transfer" ? "#A78BFA" : "#C8F060" }}>
                          {o.kind === "transfer" ? <ArrowRightLeft size={20} /> : o.kind === "contribution" ? <Users size={20} /> : <Wallet size={20} />}
                        </span>
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{o.title}</span><span className="block truncate text-sm text-ink-3">{o.sub}</span></span>
                        <span className={`money shrink-0 font-mono ${o.kind === "transfer" ? "text-ink-2" : "text-lime"}`}>{o.kind === "transfer" ? "⇄ " : "+"}{formatMoney(o.cents, "EUR", x.locale)}</span>
                      </>
                    );
                    const cls = "flex min-h-16 items-center gap-3 rounded-card border border-border bg-surface px-3 py-3";
                    return <li key={o.id}>{o.href ? <Link href={o.href} className={`${cls} transition-colors hover:bg-surface-2`}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
                  })}
                  {list.map((e) => {
                    const mine = (e.expense_splits as { member_id: string; amount_cents: number }[]).find((s) => s.member_id === me?.id)?.amount_cents;
                    const title = e.is_private ? (priv.get(e.id) ?? x("Gasto privado")) : e.description;
                    const info = e.category_id ? catInfo.get(e.category_id) : undefined;
                    return (
                      <li key={e.id}>
                        <SwipeRow id={e.id}>
                        <Link href={`/movimientos/${e.id}`} className="flex min-h-16 items-center gap-3 rounded-card border border-border bg-surface px-3 py-3 transition-colors hover:bg-surface-2">
                          <CategoryIcon systemName={info?.sysName} color={info?.color} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{title}</span>
                            <span className="block truncate text-sm text-ink-3">{e.category_id && catName.get(e.category_id) ? catName.get(e.category_id) : x("Sin categoría")}{e.is_private ? ` · ${x("privado")}` : ""}</span>
                          </span>
                          <span className="text-right">
                            <span className="money block font-mono">−{formatMoney(e.amount_cents, e.currency, x.locale)}</span>
                            {active.kind !== "personal" && mine !== undefined && <span className="money block font-mono text-sm text-ink-3">{x("tu parte")}{" "}{formatMoney(mine, e.currency, x.locale)}</span>}
                          </span>
                          <span aria-hidden className="text-ink-3">›</span>
                        </Link>
                        </SwipeRow>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
