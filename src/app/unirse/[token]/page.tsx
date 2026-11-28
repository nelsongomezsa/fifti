import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { Turnstile } from "@/components/ui/Turnstile";
import { turnstileSiteKey } from "@/lib/turnstile-public";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite, joinAsGuest } from "@/server/actions/join";
import { lookupLink } from "@/server/links";

export const metadata: Metadata = { title: "Unirse", robots: { index: false }, referrer: "no-referrer" };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const x = await getTx();
  const { token } = await params;
  const info = await lookupLink(token);
  if (!info || info.kind === "public_summary") notFound();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const next = encodeURIComponent(`/unirse/${token}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pb-10 pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <Logo height={30} />
      <div>
        <p className="text-sm text-ink-3">{x("Te han invitado a")}</p>
        <h1 className="text-2xl font-bold">{info.emoji ? `${info.emoji} ` : ""}{info.space_name}</h1>
      </div>

      {info.kind === "guest" ? (
        user && !user.is_anonymous ? (
          <p className="text-ink-2">{x("Ya tienes una cuenta. Pide a quien te invitó un enlace de invitación con cuenta.")}</p>
        ) : (
          <ActionForm action={joinAsGuest} submit={x("Entrar al plan")}>
            <input type="hidden" name="token" value={token} />
            {info.free_members.length > 0 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm text-ink-2">{x("¿Quién eres?")}</legend>
                {info.free_members.map((m) => (
                  <label key={m.id} className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-surface px-4">
                    <input type="radio" name="memberId" value={m.id} /> {m.name}
                  </label>
                ))}
                <p className="text-xs text-ink-3">{x("O escribe tu nombre si no estás en la lista:")}</p>
              </fieldset>
            )}
            <input name="name" maxLength={40} placeholder={x("Tu nombre")} aria-label={x("Tu nombre")} className={inputClass} />
            <Turnstile siteKey={turnstileSiteKey} appearance="interaction-only" />
          </ActionForm>
        )
      ) : user && !user.is_anonymous ? (
        <ActionForm action={acceptInvite} submit={x("Unirme")}>
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
