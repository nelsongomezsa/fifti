import type { Metadata } from "next";
import Link from "next/link";
import { ContributeForm } from "@/components/plan/ContributeForm";
import { getTx } from "@/i18n/tx";
import { createClient } from "@/lib/supabase/server";
import { monthStart } from "@/lib/money";
import { listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Aportar al hogar" };

export default async function ContributePage() {
  const [x, user, spaces, supabase] = await Promise.all([getTx(), requireUser(), listMySpaces(), createClient()]);
  const homes = spaces.filter((s) => s.kind === "household");
  const month = monthStart(new Date());
  const [{ data: mine }, { data: rows }] = await Promise.all([
    supabase.from("space_members").select("id, space_id").eq("user_id", user.id),
    supabase.from("contributions").select("space_id, member_id, expected_cents, paid_cents").eq("month", month),
  ]);
  const myIds = new Set((mine ?? []).map((m) => m.id));
  const data = homes.map((h) => {
    const c = (rows ?? []).find((r) => r.space_id === h.id && myIds.has(r.member_id));
    return { id: h.id, name: h.name, expectedCents: c?.expected_cents ?? 0, paidCents: c?.paid_cents ?? 0, currency: h.currency };
  });
  return (
    <section className="flex flex-col gap-5 pt-2">
      <Link href="/plan" className="flex min-h-11 items-center self-start text-sm text-ink-2">‹ {x("Plan")}</Link>
      <h1 className="text-2xl font-bold">{x("Aportar al hogar")}</h1>
      <p className="text-sm text-ink-2">{x("Sale de tu plan personal (partida Aportación al hogar) y entra en el hogar a tu nombre.")}</p>
      <ContributeForm homes={data} demo={user.app_metadata?.demo === true} />
    </section>
  );
}
