import { ViewCurrencySelect } from "@/components/money/ViewCurrencySelect";
import { getTx } from "@/i18n/tx";
import { formatMoney } from "@/lib/money";
import { ratesTo } from "@/server/fx";
import type { SessionUser } from "@/server/spaces";
import { loadViewCurrency } from "@/server/view-currency";

/** Control discreto para ver las cifras principales en otra moneda. Solo es una vista: no guarda ni convierte datos. */
export async function ViewInCurrency({ user, base, figures }: { user: SessionUser; base: string; figures: { label: string; cents: number }[] }) {
  const [x, view] = await Promise.all([getTx(), loadViewCurrency(user)]);
  const active = view && view !== base ? view : null;
  const rate = active ? (await ratesTo(active, [base])).get(base) : undefined;
  return (
    <div className="flex flex-col items-start gap-2">
      <ViewCurrencySelect base={base} value={view} />
      {active && (rate === undefined ? <p role="status" className="text-sm text-ink-3">{x("No hemos podido obtener el tipo de cambio.")}</p> : (
        <section aria-label={`${x("Totales en")} ${active}`} className="w-full rounded-card border border-dashed border-border px-4 py-3 text-sm">
          <dl className="flex flex-col gap-1">
            {figures.map((f) => (
              <div key={f.label} className="flex justify-between gap-3">
                <dt className="text-ink-2">{f.label}</dt>
                <dd className="money font-mono">≈ {formatMoney(Math.round(f.cents * rate), active, x.locale)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-xs text-ink-3">{x("Aproximado, con el cambio de hoy. Solo para verlo: no cambia tus datos.")}</p>
        </section>
      ))}
    </div>
  );
}
