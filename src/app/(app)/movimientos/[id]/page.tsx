import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditExpenseButton } from "@/components/expense/EditExpenseButton";
import { ReceiptUploader } from "@/components/expense/ReceiptUploader";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { REACTIONS } from "@/lib/validation/expense";
import { uuidSchema } from "@/lib/validation/spaces";
import { addComment, deleteExpense, toggleReaction } from "@/server/actions/expenses";
import { requireUser } from "@/server/spaces";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Detalle del gasto" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const x = await getTx();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();

  const { data: e } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
  if (!e) notFound(); // RLS: si no eres miembro, es como si no existiera
  const [{ data: members }, { data: splits }, { data: payers }, { data: priv }, { data: comments }, { data: reactions }, { data: history }, { data: tagRows }, { data: cat }] =
    await Promise.all([
      supabase.from("space_members").select("id, user_id, display_name, role").eq("space_id", e.space_id),
      supabase.from("expense_splits").select("member_id, amount_cents, share_bp").eq("expense_id", id),
      supabase.from("expense_payers").select("member_id, amount_cents").eq("expense_id", id),
      supabase.from("expense_private_details").select("description, category_id, receipt_path").eq("expense_id", id).maybeSingle(),
      supabase.from("expense_comments").select("id, member_id, body, created_at").eq("expense_id", id).order("created_at"),
      supabase.from("expense_reactions").select("member_id, emoji").eq("expense_id", id),
      supabase.from("audit_log").select("id, action, at, actor").eq("row_id", id).eq("table_name", "expenses").order("at", { ascending: false }).limit(20),
      supabase.from("expense_tags").select("tags(name)").eq("expense_id", id),
      e.category_id ? supabase.from("categories").select("name, system_key").eq("id", e.category_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
  const me = members?.find((m) => m.user_id === user.id);
  const name = (mid: string) => members?.find((m) => m.id === mid)?.display_name ?? "—";
  const canEdit = me && (me.role !== "guest" || me.id === e.created_by_member);
  const title = e.is_private ? (priv?.description ?? x("Gasto privado")) : e.description;
  const tags = ((tagRows as unknown as { tags: { name: string } | null }[]) ?? []).map((t) => t.tags?.name).filter(Boolean) as string[];
  const counts = REACTIONS.map((emoji) => ({ emoji, n: reactions?.filter((r) => r.emoji === emoji).length ?? 0, mine: !!reactions?.some((r) => r.emoji === emoji && r.member_id === me?.id) }));

  // Ticket: bucket privado; se sirve solo con URL firmada de 5 minutos
  const receiptPath = e.is_private ? priv?.receipt_path : e.receipt_path;
  const receiptUrl = receiptPath ? (await supabase.storage.from("receipts").createSignedUrl(receiptPath, 300)).data?.signedUrl : null;

  async function remove() {
    "use server";
    await deleteExpense(id);
    redirect("/movimientos");
  }

  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/movimientos" className="text-sm text-ink-2">{x("‹ Movimientos")}</Link>
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="money mt-1 font-mono text-3xl">{formatMoney(e.amount_cents, e.currency, x.locale)}</p>
        <p className="mt-1 text-sm text-ink-3">
          {new Date(`${e.spent_at}T00:00:00Z`).toLocaleDateString(x.locale, { dateStyle: "long", timeZone: "UTC" })}
          {(priv?.category_id ? null : cat?.name) ? ` · ${cat ? displayName(x, cat.name, cat.system_key) : ""}` : ""}
          {e.currency !== "EUR" || e.fx_rate !== 1 ? ` · ${x("cambio")} ${e.fx_rate}` : ""}
        </p>
        {e.is_private && <p className="mt-1 text-sm text-ink-2">{x("Gasto privado: los demás ven solo importe y reparto.")}</p>}
        {tags.length > 0 && <p className="mt-2 flex flex-wrap gap-2">{tags.map((t) => <span key={t} className="rounded-full border border-border px-3 py-1 text-xs text-ink-2">#{t}</span>)}</p>}
      </div>

      <div className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">{e.paid_from === "pot" ? x("Pagado desde el bote") : x("Pagó")}</h2>
        {e.paid_from === "member" && payers?.map((p) => (
          <p key={p.member_id} className="flex justify-between text-sm"><span>{name(p.member_id)}</span><span className="money font-mono">{formatMoney(p.amount_cents, "EUR", x.locale)}</span></p>
        ))}
        <h2 className="mb-2 mt-4 font-semibold">{x("Reparto")}</h2>
        {splits?.map((s) => (
          <p key={s.member_id} className="flex justify-between text-sm text-ink-2">
            <span>{name(s.member_id)} <span className="text-ink-3">{(s.share_bp / 100).toFixed(2).replace(".", ",")} %</span></span>
            <span className="money font-mono text-ink">{formatMoney(s.amount_cents, "EUR", x.locale)}</span>
          </p>
        ))}
      </div>

      {receiptUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={receiptUrl} alt={x("Foto del ticket")} className="max-h-96 w-full rounded-card border border-border object-contain" referrerPolicy="no-referrer" />
      )}
      {canEdit && <ReceiptUploader expenseId={id} hasReceipt={!!receiptPath} />}

      <div className="flex flex-wrap gap-2" role="group" aria-label={x("Reacciones")}>
        {counts.map((c) => (
          <form action={toggleReaction} key={c.emoji}>
            <input type="hidden" name="expenseId" value={id} /><input type="hidden" name="spaceId" value={e.space_id} />
            <input type="hidden" name="emoji" value={c.emoji} />
            <button aria-pressed={c.mine} aria-label={`Reaccionar ${c.emoji}`}
              className={`min-h-11 min-w-11 rounded-full border px-3 text-sm ${c.mine ? "border-accent bg-surface-2" : "border-border"}`}>
              {c.emoji}{c.n > 0 ? ` ${c.n}` : ""}
            </button>
          </form>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">{x("Comentarios")}</h2>
        {comments?.map((c) => (
          // El texto se renderiza como texto (React lo escapa); nunca como HTML.
          <p key={c.id} className="rounded-card border border-border bg-surface px-4 py-3 text-sm">
            <span className="block text-xs text-ink-3">{name(c.member_id)}</span>{c.body}
          </p>
        ))}
        <ActionForm action={addComment} submit={x("Comentar")} tone="plain">
          <input type="hidden" name="expenseId" value={id} /><input type="hidden" name="spaceId" value={e.space_id} />
          <input name="body" required maxLength={500} placeholder={x("Escribe un comentario")} aria-label={x("Comentario")} className={inputClass} />
        </ActionForm>
      </div>

      {canEdit && (
        <div className="flex gap-3">
          <EditExpenseButton spaceId={e.space_id} prefill={{
            spaceId: e.space_id, amountCents: e.amount_cents, categoryId: e.category_id ?? priv?.category_id ?? null, description: title,
            participants: splits?.map((s) => s.member_id), payerId: payers?.[0]?.member_id, tags: tags.join(" "),
            edit: { id, clientId: e.client_id, spentAt: e.spent_at, paidFrom: e.paid_from as "member" | "pot", splitMode: e.split_mode as "default" | "equal" | "custom", isPrivate: e.is_private },
          }} />
          <form action={remove}><button className="min-h-11 rounded-full border border-border px-5 font-semibold text-over-text">{x("Borrar")}</button></form>
        </div>
      )}

      <div>
        <h2 className="mb-2 font-semibold">{x("Historial")}</h2>
        <ul className="flex flex-col gap-1 text-sm text-ink-3">
          {history?.map((h) => (
            <li key={h.id}>
              {x({ insert: "Creado", update: "Editado", delete: "Borrado" }[h.action as "insert"] ?? h.action)} · {new Date(h.at).toLocaleString(x.locale)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
