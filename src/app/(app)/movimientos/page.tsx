import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import type { Metadata } from "next";
import Link from "next/link";
import { PendingExpenseRows } from "@/components/expense/optimistic";
import { addMonths, formatMoney, isMonthStart, monthStart } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Movimientos" };

type SP = { mes?: string; cat?: string; persona?: string; tag?: string; q?: string };
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
    .select("id, description, spent_at, amount_cents, currency, category_id, is_private, created_by_member, expense_splits(member_id, amount_cents), expense_tags(tags(name))")
    .eq("space_id", active.id).gte("spent_at", month).lt("spent_at", next)
    .order("spent_at", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (sp.cat && uuid.test(sp.cat)) q = q.eq("category_id", sp.cat);
  if (sp.persona && uuid.test(sp.persona)) q = q.eq("created_by_member", sp.persona);
  if (sp.q && esc(sp.q)) q = q.ilike("description", `%${esc(sp.q)}%`);
  // Todas las consultas son independientes: una sola ronda de red
  const [{ data: members }, { data: cats }, { data: expenses }, { data: privates }, { data: mirrors }] = await Promise.all([
    supabase.from("space_members").select("id, user_id, display_name").eq("space_id", active.id),
    supabase.from("categories").select("id, name, system_key").eq("space_id", active.id),
    q,
    supabase.from("expense_private_details").select("expense_id, description"),
    active.kind === "personal"
      ? supabase.from("personal_mirror").select("id, label, amount_cents, spent_at").eq("enabled", true).gte("spent_at", month).lt("spent_at", next).order("spent_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; label: string; amount_cents: number; spent_at: string }[] }),
  ]);
  const me = members?.find((m) => m.user_id === user.id);
  const priv = new Map((privates ?? []).map((p) => [p.expense_id, p.description]));
  type Row = NonNullable<typeof expenses>[number];
  const tagOf = (e: Row) => ((e.expense_tags as unknown as { tags: { name: string } | null }[]) ?? []).map((t) => t.tags?.name).filter(Boolean) as string[];
  const tag = sp.tag?.toLowerCase().replace(/^#/, "");
  const rows = (expenses ?? []).filter((e) => !tag || tagOf(e).includes(tag));
  const catName = new Map((cats ?? []).map((c) => [c.id, displayName(x, c.name, c.system_key)]));
  const total = rows.reduce((a, e) => a + e.amount_cents, 0);
  const href = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/movimientos?${p.toString()}`;
  };

  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">{x("Movimientos")}</h1>

      <div className="flex items-center justify-between">
        <Link href={href({ mes: addMonths(month, -1) })} aria-label={x("Mes anterior")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">‹</Link>
        <span className="font-semibold first-letter:uppercase">{monthLabel}</span>
        <Link href={href({ mes: next })} aria-label={x("Mes siguiente")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border">›</Link>
      </div>

      <form className="flex flex-wrap gap-2" action="/movimientos">
        <input type="hidden" name="mes" value={month} />
        <input name="q" defaultValue={sp.q} placeholder={x("Buscar")} aria-label={x("Buscar")} maxLength={50}
          className="min-h-11 flex-1 rounded-card border border-border bg-surface px-3 text-sm" />
        <select name="cat" defaultValue={sp.cat ?? ""} aria-label={x("Categoría")} className="min-h-11 rounded-card border border-border bg-surface px-2 text-sm">
          <option value="">{x("Categoría")}</option>
          {cats?.map((c) => <option key={c.id} value={c.id}>{displayName(x, c.name, c.system_key)}</option>)}
        </select>
        {active.kind !== "personal" && (
          <select name="persona" defaultValue={sp.persona ?? ""} aria-label={x("Persona")} className="min-h-11 rounded-card border border-border bg-surface px-2 text-sm">
            <option value="">{x("Persona")}</option>
            {members?.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        )}
        <input name="tag" defaultValue={sp.tag} placeholder={x("#etiqueta")} aria-label={x("Etiqueta")} maxLength={31} className="min-h-11 w-28 rounded-card border border-border bg-surface px-3 text-sm" />
        <button className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-on-accent">{x("Filtrar")}</button>
      </form>

      <p className="flex justify-between text-sm text-ink-2">
        <span>{rows.length} {x("gastos")}</span>
        <span className="money font-mono text-ink">{formatMoney(total, "EUR", x.locale)}</span>
      </p>

      <PendingExpenseRows spaceId={active.id} month={month} />
      {(mirrors ?? []).length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={x("Tu parte de gastos de grupo")}>
          {mirrors!.map((mr) => (
            <li key={mr.id} className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-dashed border-border px-4 py-3">
              <span><span className="block font-medium">{x("Tu parte de")}{" "}{mr.label}</span><span className="text-xs text-ink-3">{mr.spent_at} {x("· reflejo de grupo")}</span></span>
              <span className="money font-mono">{formatMoney(mr.amount_cents, "EUR", x.locale)}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{x("Todavía no hay gastos este mes en esta burbuja.")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((e) => {
            const mine = (e.expense_splits as { member_id: string; amount_cents: number }[]).find((s) => s.member_id === me?.id)?.amount_cents;
            const title = e.is_private ? (priv.get(e.id) ?? x("Gasto privado")) : e.description;
            return (
              <li key={e.id}>
                <Link href={`/movimientos/${e.id}`} className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{title}</span>
                    <span className="text-xs text-ink-3">
                      {new Date(`${e.spent_at}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", timeZone: "UTC" })}
                      {e.category_id && catName.get(e.category_id) ? ` · ${catName.get(e.category_id)}` : ""}
                      {e.is_private ? " · privado" : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="money block font-mono">{formatMoney(e.amount_cents, e.currency, x.locale)}</span>
                    {active.kind !== "personal" && mine !== undefined && (
                      <span className="money block font-mono text-xs text-ink-3">{x("tu parte")}{" "}{formatMoney(mine, e.currency, x.locale)}</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/ingreso" className="min-h-12 rounded-full border border-border py-3 text-center font-semibold">{x("Añadir ingreso")}</Link>
    </section>
  );
}
