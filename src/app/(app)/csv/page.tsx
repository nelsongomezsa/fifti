import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import { CsvImport } from "@/components/ui/CsvImport";
import { createClient } from "@/lib/supabase/server";
import { loadAccounts } from "@/server/accounts";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Importar y exportar" };

export default async function CsvPage() {
  const x = await getTx();
  const user = await requireUser();
  const active = await getActiveSpace(await listMySpaces());
  if (!active || user.is_anonymous) return <p className="pt-4 text-ink-2">{x("Necesitas una cuenta para importar y exportar.")}</p>;
  const spaceAccounts = (await loadAccounts(await createClient(), user.id)).filter((a) => a.spaceId === active.id).map((a) => ({ id: a.id, name: a.name, isDefault: a.mine && a.isDefault, balanceCents: a.balanceCents, currency: a.currency }));
  return (
    <section className="flex flex-col gap-5 pt-2">
      <h1 className="text-2xl font-bold">{x("Importar y exportar")}</h1>
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{x("Exportar")}</h2>
        <p className="text-sm text-ink-3">{x("Descarga los gastos de")}{" "}{active.kind === "personal" ? "tu burbuja personal" : active.name} {x("en CSV.")}</p>
        <a href={`/api/export?space=${active.id}`} className="min-h-11 rounded-full border border-border px-5 py-2.5 text-center font-semibold">{x("Descargar CSV")}</a>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{x("Importar en")}{" "}{active.kind === "personal" ? x("Personal") : active.name}</h2>
        <p className="text-sm text-ink-3">{x("Sube el extracto de tu banco (Santander, BBVA, CaixaBank, ING, Revolut, N26) o un CSV con fecha, concepto e importe. Máximo 500 filas y 1 MB. Verás una vista previa, podrás elegir filas y categorías, y se marcan los duplicados.")}</p>
        <CsvImport spaceId={active.id} currency={active.currency} accounts={spaceAccounts} />
      </div>
    </section>
  );
}
