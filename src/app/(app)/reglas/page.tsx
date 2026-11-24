import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import { createClient } from "@/lib/supabase/server";
import { createRule, deleteRule, moveRule, updateRule } from "@/server/actions/rules";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Reglas" };

const TYPES = { contains: "Contiene", starts_with: "Empieza por", exact: "Es exactamente" } as const;

export default async function RulesPage() {
  const x = await getTx();
  await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active) return null;
  const supabase = await createClient();
  const [{ data: rules }, { data: cats }] = await Promise.all([
    supabase.from("category_rules").select("id, match_text, match_type, category_id, priority").eq("space_id", active.id).order("priority").order("created_at"),
    supabase.from("categories").select("id, name, system_key").eq("space_id", active.id).order("name"),
  ]);
  const catName = (id: string) => { const c = cats?.find((k) => k.id === id); return c ? displayName(x, c.name, c.system_key) : "—"; };
  const catOptions = (cats ?? []).map((c) => <option key={c.id} value={c.id}>{displayName(x, c.name, c.system_key)}</option>);
  const typeOptions = (Object.keys(TYPES) as (keyof typeof TYPES)[]).map((t) => <option key={t} value={t}>{x(TYPES[t])}</option>);

  return (
    <section className="flex flex-col gap-4 pt-2">
      <Link href="/mas" className="min-h-11 self-start text-sm text-ink-2">{x("‹ Más")}</Link>
      <h1 className="text-2xl font-bold">{x("Reglas de categoría")}</h1>
      <p className="text-sm text-ink-2">{x("Si el concepto coincide, Fifti propone esa categoría al apuntar, importar o escribir una frase. Se aplica la primera de la lista.")} <span className="text-ink-3">({active.kind === "personal" ? x("Personal") : active.name})</span></p>

      {(rules ?? []).length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-ink-2">{x("Aún no hay reglas. Crea la primera abajo.")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rules!.map((r, i) => (
            <li key={r.id} className="rounded-card border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate"><span className="text-ink-3">{x(TYPES[r.match_type as keyof typeof TYPES])}</span> <strong>{r.match_text}</strong> → {catName(r.category_id)}</p>
                <div className="flex shrink-0 gap-1">
                  <form action={moveRule}><input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="dir" value="up" />
                    <button disabled={i === 0} aria-label={x("Subir")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border disabled:opacity-40">↑</button></form>
                  <form action={moveRule}><input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="dir" value="down" />
                    <button disabled={i === rules!.length - 1} aria-label={x("Bajar")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border disabled:opacity-40">↓</button></form>
                </div>
              </div>
              <details className="mt-1">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{x("Editar")}</summary>
                <ActionForm action={updateRule} submit={x("Guardar")} className="mt-1 flex flex-col gap-3">
                  <input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="id" value={r.id} />
                  <select name="matchType" defaultValue={r.match_type} aria-label={x("Tipo de coincidencia")} className={inputClass}>{typeOptions}</select>
                  <input name="matchText" required maxLength={60} defaultValue={r.match_text} aria-label={x("Texto")} className={inputClass} />
                  <select name="categoryId" defaultValue={r.category_id} aria-label={x("Categoría")} className={inputClass}>{catOptions}</select>
                </ActionForm>
                <form action={deleteRule} className="mt-2"><input type="hidden" name="spaceId" value={active.id} /><input type="hidden" name="id" value={r.id} />
                  <button className="min-h-11 rounded-full border border-border px-5 font-semibold text-over-text">{x("Borrar regla")}</button></form>
              </details>
            </li>
          ))}
        </ol>
      )}

      <h2 className="text-lg font-semibold">{x("Nueva regla")}</h2>
      <div className="rounded-card border border-border bg-surface p-4">
        <ActionForm action={createRule} submit={x("Crear regla")} className="flex flex-col gap-3">
          <input type="hidden" name="spaceId" value={active.id} />
          <select name="matchType" defaultValue="contains" aria-label={x("Tipo de coincidencia")} className={inputClass}>{typeOptions}</select>
          <input name="matchText" required maxLength={60} placeholder={x("Mercadona")} aria-label={x("Texto")} className={inputClass} />
          <select name="categoryId" required defaultValue="" aria-label={x("Categoría")} className={inputClass}>
            <option value="" disabled>{x("Categoría")}</option>{catOptions}
          </select>
        </ActionForm>
      </div>
    </section>
  );
}
