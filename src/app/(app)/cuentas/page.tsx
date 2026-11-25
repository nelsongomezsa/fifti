import type { Metadata } from "next";
import Link from "next/link";
import { AccountEditor } from "@/components/accounts/AccountForms";
import { EmptyState } from "@/components/ui/EmptyState";
import { getTx } from "@/i18n/tx";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { loadAccounts } from "@/server/accounts";
import { listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Mis cuentas" };

export default async function AccountsPage() {
  const [x, user, spaces, supabase] = await Promise.all([getTx(), requireUser(), listMySpaces(), createClient()]);
  const accounts = await loadAccounts(supabase, user.id);
  const demo = user.app_metadata?.demo === true;
  const total = accounts.filter((a) => a.mine).reduce((s, a) => s + a.balanceCents, 0);
  const spaceName = (id: string) => { const s = spaces.find((q) => q.id === id); return s?.kind === "personal" ? x("Personal") : s?.name ?? ""; };
  const kindLabel = { payroll: x("Nómina"), daily: x("Día a día"), savings: x("Ahorro"), shared: x("Común") } as const;
  return (
    <section className="flex flex-col gap-4 pt-2">
      <div className="flex items-center gap-1">
        <Link href="/ajustes" aria-label={x("Volver")} className="grid min-h-11 min-w-11 place-items-center text-xl text-ink-2">‹</Link>
        <h1 className="flex-1 text-2xl font-bold">{x("Mis cuentas")}</h1>
        <AccountEditor spaces={spaces} label={x("Nueva cuenta")} demo={demo} />
      </div>
      <p className="text-sm text-ink-3">{x("Fifti no se conecta a tu banco: el saldo sale de lo que apuntas e importas.")}</p>
      {accounts.length === 0 ? (
        <EmptyState title={x("Aún no tienes cuentas")} text={x("Añade la cuenta donde cobras y la que usas día a día para ver cuánto hay en cada una.")} />
      ) : (
        <>
          <div className="rounded-card border border-border bg-surface p-4">
            <p className="t-label">{x("Total en tus cuentas")}</p>
            <p className="money t-figure mt-1">{formatMoney(total, "EUR", x.locale)}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link href={`/cuentas/${a.id}`} prefetch className="flex min-h-16 items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
                  <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: a.color }} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{a.name}{a.isDefault ? ` · ${x("por defecto")}` : ""}</span>
                    <span className="block truncate text-xs text-ink-3">{[a.bank, kindLabel[a.kind], spaceName(a.spaceId)].filter(Boolean).join(" · ")}</span></span>
                  <span className="money shrink-0 font-mono">{formatMoney(a.balanceCents, "EUR", x.locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/traspaso" className="flex min-h-12 items-center justify-center rounded-full border border-border font-semibold">{x("Hacer un traspaso")}</Link>
        </>
      )}
    </section>
  );
}
