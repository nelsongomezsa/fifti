import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { createSpace } from "@/server/actions/spaces";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Nueva burbuja" };

const TEMPLATES = [
  ["night", "Noche"], ["dinner", "Cena"], ["trip", "Viaje"], ["flat", "Piso"],
] as const;

export default async function NewSpacePage() {
  const user = await requireUser();
  if (user.is_anonymous) redirect("/inicio");
  return (
    <section className="flex flex-col gap-5 pt-2">
      <h1 className="text-2xl font-bold">Nueva burbuja</h1>
      <ActionForm action={createSpace} submit="Crear burbuja">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-ink-2">Tipo</legend>
          <label className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-surface px-4">
            <input type="radio" name="kind" value="group" defaultChecked /> Plan espontáneo (cena, viaje, noche)
          </label>
          <label className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-surface px-4">
            <input type="radio" name="kind" value="household" /> Hogar o pareja (fija)
          </label>
        </fieldset>
        <label className="flex flex-col gap-1.5 text-sm text-ink-2">
          Nombre
          <input name="name" required maxLength={60} placeholder="Viaje Lisboa" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-ink-2">
          Plantilla (solo planes)
          <select name="template" defaultValue="" className={inputClass}>
            <option value="">Sin plantilla</option>
            {TEMPLATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-ink-2">
          Moneda
          <input name="currency" defaultValue="EUR" maxLength={3} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm text-ink-2">Desde (opcional)
            <input type="date" name="startsOn" className={inputClass} /></label>
          <label className="flex flex-col gap-1.5 text-sm text-ink-2">Hasta (opcional)
            <input type="date" name="endsOn" className={inputClass} /></label>
        </div>
      </ActionForm>
    </section>
  );
}
