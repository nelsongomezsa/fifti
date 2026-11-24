import Link from "next/link";
import { getTx } from "@/i18n/tx";

/** Tarjeta de primera vez: mientras no haya plan no se enseñan porcentajes ni avisos en rojo. */
export async function SetupPlanCard() {
  const x = await getTx();
  return (
    <section aria-labelledby="setup-plan" className="rounded-card border border-border bg-surface p-5">
      <h2 id="setup-plan" className="text-lg font-bold">{x("Configura tu plan")}</h2>
      <p className="mt-1 text-sm text-ink-2">{x("Dinos cuánto ingresas este mes y te sugerimos cómo repartirlo. Podrás cambiarlo cuando quieras.")}</p>
      <Link href="/bienvenida" className="mt-4 inline-flex min-h-12 items-center rounded-full bg-accent px-6 font-semibold text-on-accent">{x("Empezar")}</Link>
    </section>
  );
}
