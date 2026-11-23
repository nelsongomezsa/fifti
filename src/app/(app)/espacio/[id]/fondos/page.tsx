import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { addCategory, addFund } from "@/server/actions/expenses";

export const metadata: Metadata = { title: "Fondos y categorías" };

const KINDS = [["fixed", "Fijos"], ["variable", "Variable"], ["leisure", "Ocio"], ["savings", "Ahorro"], ["investment", "Inversión"], ["emergency", "Imprevistos"], ["other", "Otro"]] as const;

export default async function FundsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: space } = await supabase.from("spaces").select("id, name").eq("id", id).maybeSingle();
  if (!space) notFound();
  const [{ data: funds }, { data: cats }] = await Promise.all([
    supabase.from("funds").select("id, name, kind, color").eq("space_id", id).order("position"),
    supabase.from("categories").select("id, fund_id, name").eq("space_id", id).order("name"),
  ]);
  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href={`/espacio/${id}`} className="text-sm text-ink-2">‹ {space.name}</Link>
      <h1 className="text-2xl font-bold">Fondos y categorías</h1>
      {funds?.map((f) => (
        <div key={f.id} className="rounded-card border border-border bg-surface p-4">
          <h2 className="flex items-center gap-2 font-semibold"><span aria-hidden className="size-2.5 rounded-full" style={{ background: f.color }} />{f.name}</h2>
          <p className="mt-2 flex flex-wrap gap-2 text-sm text-ink-2">
            {cats?.filter((c) => c.fund_id === f.id).map((c) => <span key={c.id} className="rounded-full border border-border px-3 py-1">{c.name}</span>)}
          </p>
          <ActionForm action={addCategory} submit="Añadir categoría" tone="plain" className="mt-3 flex gap-2">
            <input type="hidden" name="spaceId" value={id} /><input type="hidden" name="fundId" value={f.id} />
            <input name="name" required maxLength={40} placeholder="Nueva categoría" aria-label="Nueva categoría" className={inputClass} />
          </ActionForm>
        </div>
      ))}
      <h2 className="font-semibold">Nuevo fondo</h2>
      <ActionForm action={addFund} submit="Crear fondo">
        <input type="hidden" name="spaceId" value={id} />
        <input name="name" required maxLength={40} placeholder="Nombre del fondo" aria-label="Nombre del fondo" className={inputClass} />
        <select name="kind" className={inputClass} aria-label="Tipo" defaultValue="other">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </ActionForm>
    </section>
  );
}
