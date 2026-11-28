import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryRow, FundRow } from "@/components/spaces/CategoryRows";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { SwipeHint } from "@/components/ui/SwipeHint";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { addCategory, addFund } from "@/server/actions/expenses";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Fondos y categorías" };

const KINDS = [["fixed", "Fijos"], ["variable", "Variable"], ["leisure", "Ocio"], ["savings", "Ahorro"], ["investment", "Inversión"], ["emergency", "Imprevistos"], ["other", "Otro"]] as const;

export default async function FundsPage({ params }: { params: Promise<{ id: string }> }) {
  const x = await getTx();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();
  const { data: space } = await supabase.from("spaces").select("id, name, kind").eq("id", id).maybeSingle();
  if (!space) notFound();
  const [{ data: funds }, { data: cats }, { data: me }] = await Promise.all([
    supabase.from("funds").select("id, name, kind, color, system_key, linked_space_id").eq("space_id", id).order("position"),
    supabase.from("categories").select("id, fund_id, name, system_key, hidden").eq("space_id", id).order("name"),
    supabase.from("space_members").select("role").eq("space_id", id).eq("user_id", user.id).maybeSingle(),
  ]);
  const canEdit = !!me && me.role !== "guest";
  const fundName = (f: { name: string; system_key: string | null }) => displayName(x, f.name, f.system_key);
  const catName = (c: { name: string; system_key: string | null }) => displayName(x, c.name, c.system_key);
  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href={space.kind === "personal" ? "/plan" : `/espacio/${id}`} className="flex min-h-11 items-center self-start text-sm text-ink-2">‹ {space.kind === "personal" ? x("Plan") : space.name}</Link>
      <h1 className="text-2xl font-bold">{x("Fondos y categorías")}</h1>
      {canEdit && <SwipeHint />}
      {funds?.map((f) => (
        <div key={f.id} className="rounded-card border border-border bg-surface p-4">
          <FundRow id={f.id} name={fundName(f)} color={f.color} canDelete={canEdit && !f.system_key && !f.linked_space_id}
            others={(funds ?? []).filter((o) => o.id !== f.id).map((o) => ({ id: o.id, name: fundName(o) }))} />
          <ul className="mt-2 flex flex-col gap-2">
            {cats?.filter((c) => c.fund_id === f.id).map((c) => (
              <li key={c.id}>
                <CategoryRow id={c.id} name={catName(c)} system={!!c.system_key} hidden={c.hidden} canEdit={canEdit}
                  others={(cats ?? []).filter((o) => o.id !== c.id && !o.hidden).map((o) => ({ id: o.id, name: catName(o) }))} />
              </li>
            ))}
          </ul>
          {canEdit && (
            <ActionForm action={addCategory} optimistic submit={x("Añadir categoría")} tone="plain" className="mt-3 flex gap-2">
              <input type="hidden" name="spaceId" value={id} /><input type="hidden" name="fundId" value={f.id} />
              <input name="name" required maxLength={40} placeholder={x("Nueva categoría")} aria-label={x("Nueva categoría")} className={inputClass} />
            </ActionForm>
          )}
        </div>
      ))}
      {canEdit && (
        <>
          <h2 className="font-semibold">{x("Nuevo fondo")}</h2>
          <ActionForm action={addFund} optimistic submit={x("Crear fondo")}>
            <input type="hidden" name="spaceId" value={id} />
            <input name="name" required maxLength={40} placeholder={x("Nombre del fondo")} aria-label={x("Nombre del fondo")} className={inputClass} />
            <select name="kind" className={inputClass} aria-label={x("Tipo")} defaultValue="other">{KINDS.map(([v, l]) => <option key={v} value={v}>{x(l)}</option>)}</select>
          </ActionForm>
        </>
      )}
    </section>
  );
}
