import type { Metadata } from "next";
import Link from "next/link";
import { TransferForm } from "@/components/accounts/AccountForms";
import { getTx } from "@/i18n/tx";
import { createClient } from "@/lib/supabase/server";
import { loadAccounts } from "@/server/accounts";
import { listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Traspaso" };

export default async function TransferPage({ searchParams }: { searchParams: Promise<{ de?: string; a?: string; importe?: string; origen?: string }> }) {
  const [x, user, supabase, sp, spaces] = await Promise.all([getTx(), requireUser(), createClient(), searchParams, listMySpaces()]);
  const accounts = await loadAccounts(supabase, user.id);
  const uuid = /^[0-9a-f-]{36}$/i;
  const cents = Number(sp.importe);
  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/cuentas" className="flex min-h-11 items-center self-start text-sm text-ink-2">‹ {x("Mis cuentas")}</Link>
      <h1 className="text-2xl font-bold">{x("Traspaso")}</h1>
      <p className="text-sm text-ink-2">{x("Mueve saldo entre tus cuentas. No cuenta como gasto ni ingreso, y Fifti no mueve dinero en tu banco: hazlo tú allí.")}</p>
      <TransferForm
        spaces={spaces}
        usedColors={accounts.map((a) => a.color)}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, color: a.color, kind: a.kind, balanceCents: a.balanceCents, mine: a.mine, currency: a.currency }))}
        demo={user.app_metadata?.demo === true}
        initial={{ from: sp.de && uuid.test(sp.de) ? sp.de : undefined, to: sp.a && uuid.test(sp.a) ? sp.a : undefined, cents: Number.isInteger(cents) && cents > 0 ? cents : undefined, source: sp.origen === "nomina" ? "payroll_split" : "manual" }}
      />
    </section>
  );
}
