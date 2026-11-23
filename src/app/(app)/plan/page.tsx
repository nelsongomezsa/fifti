import type { Metadata } from "next";
import { getActiveSpace, listMySpaces } from "@/server/spaces";

export const metadata: Metadata = { title: "Plan" };

export default async function Page() {
  const active = await getActiveSpace(await listMySpaces());
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">Plan</h1>
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm text-ink-3">Burbuja activa</p>
        <p className="mt-1 flex items-center gap-2 text-lg font-semibold"><span aria-hidden className="size-2.5 rounded-full bg-accent" />{active?.name}</p>
        <p className="mt-3 text-ink-2">Tu plan mensual por fondos. Llega en la fase 6.</p>
      </div>
    </section>
  );
}
