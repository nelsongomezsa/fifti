import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { createSpace } from "@/server/actions/spaces";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Nuevo espacio" };

const TEMPLATES = [
  ["night", "Noche"], ["dinner", "Cena"], ["trip", "Viaje"], ["flat", "Piso"],
] as const;

export default async function NewSpacePage() {
  const x = await getTx();
  const user = await requireUser();
  if (user.is_anonymous) redirect("/inicio");
  return (
    <section className="flex flex-col gap-5 pt-2">
      <h1 className="text-2xl font-bold">{x("Nueva burbuja")}</h1>
      <ActionForm action={createSpace} submit={x("Crear burbuja")}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-ink-2">{x("Tipo")}</legend>
          <label className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-surface px-4">
            <input type="radio" name="kind" value="group" defaultChecked /> {x("Plan espontáneo (cena, viaje, noche)")}</label>
          <label className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-surface px-4">
            <input type="radio" name="kind" value="household" /> {x("Hogar o pareja (fija)")}</label>
        </fieldset>
        <label className="flex flex-col gap-1.5 text-sm text-ink-2">
          {x("Nombre")}<input name="name" required maxLength={60} placeholder={x("Viaje Lisboa")} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-ink-2">
          {x("Plantilla (solo planes)")}<select name="template" defaultValue="" className={inputClass}>
            <option value="">{x("Sin plantilla")}</option>
            {TEMPLATES.map(([v, l]) => <option key={v} value={v}>{x(l)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-ink-2">
          {x("Moneda")}<input name="currency" defaultValue="EUR" maxLength={3} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm text-ink-2">{x("Desde (opcional)")}<input type="date" name="startsOn" className={inputClass} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-ink-2">{x("Hasta (opcional)")}<input type="date" name="endsOn" className={inputClass} /></label>
        </div>
      </ActionForm>
    </section>
  );
}
