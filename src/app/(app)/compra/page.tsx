import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingList } from "@/components/shopping/ShoppingList";
import { getTx } from "@/i18n/tx";
import { createClient } from "@/lib/supabase/server";
import type { ShoppingItem } from "@/server/actions/shopping";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Lista de la compra" };

export default async function ShoppingPage() {
  const x = await getTx();
  const user = await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active) return null;
  const back = <Link href="/mas" className="min-h-11 self-start text-sm text-ink-2">{x("‹ Más")}</Link>;
  if (active.kind === "personal" || user.is_anonymous) {
    return (
      <section className="flex flex-col gap-4 pt-2">{back}
        <h1 className="text-2xl font-bold">{x("Lista de la compra")}</h1>
        <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{x("La lista compartida es para hogares y grupos. Cambia de burbuja arriba.")}</p>
      </section>
    );
  }
  const supabase = await createClient();
  const [{ data: rows }, { data: members }, { data: space }] = await Promise.all([
    supabase.from("shopping_items").select("id, text, quantity, checked, added_by, shopping_lists!inner(closed_at)").eq("space_id", active.id).is("shopping_lists.closed_at", null).order("created_at"),
    supabase.from("space_members").select("user_id, display_name").eq("space_id", active.id),
    supabase.from("spaces").select("base_currency").eq("id", active.id).maybeSingle(),
  ]);
  const items: ShoppingItem[] = (rows ?? []).map((r) => ({ id: r.id, text: r.text, quantity: r.quantity, checked: r.checked, addedBy: r.added_by }));
  const names = Object.fromEntries((members ?? []).filter((m) => m.user_id).map((m) => [m.user_id as string, m.display_name]));
  return (
    <section className="flex flex-col gap-4 pt-2">
      {back}
      <h1 className="text-2xl font-bold">{x("Lista de la compra")}</h1>
      <p className="text-sm text-ink-3">{active.name}</p>
      <ShoppingList spaceId={active.id} items={items} names={names} currency={space?.base_currency ?? "EUR"} />
    </section>
  );
}
