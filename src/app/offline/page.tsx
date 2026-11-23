import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Sin conexión" };

export default async function OfflinePage() {
  const x = await getTx();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <Logo height={34} />
      <h1 className="text-2xl font-bold">{x("Sin conexión")}</h1>
      <p className="text-ink-2">
        {x("No hay internet ahora mismo. Los gastos que apuntes se guardan en el dispositivo y se suben solos cuando vuelva la conexión.")}</p>
    </main>
  );
}
