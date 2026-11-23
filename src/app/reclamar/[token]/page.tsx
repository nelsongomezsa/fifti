import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ActionForm } from "@/components/ui/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { isValidToken } from "@/lib/security/tokens";
import { claimMember } from "@/server/actions/join";

export const metadata: Metadata = { title: "Reclamar perfil", robots: { index: false } };

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const x = await getTx();
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const next = encodeURIComponent(`/reclamar/${token}`);
  const valid = isValidToken(token);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo height={30} />
      <h1 className="text-2xl font-bold">{x("Reclamar tu perfil")}</h1>
      <p className="text-ink-2">{x("Te quedarás con este perfil y todo su historial en la cuenta con la que estás.")}</p>
      {!valid ? (
        <p role="alert" className="text-over-text">{x("Enlace no válido.")}</p>
      ) : user && !user.is_anonymous ? (
        <ActionForm action={claimMember} submit={x("Reclamar perfil")}>
          <input type="hidden" name="token" value={token} />
        </ActionForm>
      ) : (
        <div className="flex gap-3">
          <Link href={`/login?next=${next}`} className="min-h-12 rounded-full bg-lime px-6 py-3 font-semibold text-on-accent">{x("Entrar")}</Link>
          <Link href={`/registro?next=${next}`} className="min-h-12 rounded-full border border-border px-6 py-3 font-semibold">{x("Crear cuenta")}</Link>
        </div>
      )}
    </main>
  );
}
