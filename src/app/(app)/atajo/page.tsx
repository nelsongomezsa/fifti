import type { Metadata } from "next";
import Link from "next/link";
import { getTx } from "@/i18n/tx";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Atajo de Siri" };

export default async function ShortcutPage() {
  const x = await getTx();
  const base = publicEnv().NEXT_PUBLIC_SITE_URL;
  const steps = [
    x("Abre la app Atajos del iPhone y toca + para crear un atajo nuevo."),
    x("Ponle de nombre «Gasto en Fifti»."),
    x("Añade la acción «Solicitar entrada», tipo Número, con el aviso «¿Cuánto has gastado?». Es el importe."),
    x("Añade otra «Solicitar entrada», tipo Texto, con el aviso «¿En qué?». Es el concepto."),
    x("Añade la acción «URL» y pega la dirección de abajo. En importe y concepto inserta las dos respuestas anteriores."),
    x("Añade «Abrir URL». Guarda el atajo."),
  ];
  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/mas" className="min-h-11 self-start text-sm text-ink-2">{x("‹ Más")}</Link>
      <h1 className="text-2xl font-bold">{x("Apunta un gasto sin abrir la app")}</h1>
      <p className="text-ink-2">{x("El atajo te pregunta el importe y el concepto y abre Fifti con la hoja ya rellena. No guarda nada solo: tú confirmas con un toque.")}</p>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-ink-2">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
      <div>
        <p className="mb-1 text-sm text-ink-3">{x("Dirección para la acción URL")}</p>
        <code className="block break-all rounded-card border border-border bg-surface p-3 font-mono text-sm">{`${base}/nuevo?importe=[Importe]&concepto=[Concepto]`}</code>
        <p className="mt-2 text-xs text-ink-3">{x("Opcional: añade &burbuja=personal o &categoria=Súper.")}</p>
      </div>
      <h2 className="text-lg font-semibold">{x("Dónde ponerlo")}</h2>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-ink-2">
        <li>{x("Pantalla de bloqueo: mantén pulsada la pantalla de bloqueo, toca Personalizar y añade el control del atajo.")}</li>
        <li>{x("Botón de acción (iPhone 15 Pro o posterior): Ajustes › Botón de acción › Atajo › Gasto en Fifti.")}</li>
        <li>{x("Siri: di «Oye Siri, Gasto en Fifti», el mismo nombre del atajo.")}</li>
      </ul>
    </section>
  );
}
