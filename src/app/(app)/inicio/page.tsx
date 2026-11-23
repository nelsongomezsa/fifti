import type { Metadata } from "next";
import { getActiveSpace, listMySpaces } from "@/server/spaces";

export const metadata: Metadata = { title: "Inicio" };

export default async function Page() {
  const active = await getActiveSpace(await listMySpaces());
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">Inicio</h1>
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm text-ink-3">Burbuja activa</p>
        <p className="mt-1 flex items-center gap-2 text-lg font-semibold"><span aria-hidden className="size-2.5 rounded-full bg-accent" />{active?.name}</p>
        <p className="mt-3 text-ink-2">Aquí verás cuánto te sobra este mes, tus gastos y tus fondos.</p>
      </div>
    </section>
  );
}
