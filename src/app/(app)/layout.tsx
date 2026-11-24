import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppLock } from "@/components/lock/AppLock";
import { PendingExpensesProvider } from "@/components/expense/optimistic";
import { createClient } from "@/lib/supabase/server";
import { toggleDiscreet } from "@/server/actions/prefs";
import { Logo } from "@/components/brand/Logo";
import { BottomNav } from "@/components/nav/BottomNav";
import { PendingIndicator } from "@/components/pwa/PendingIndicator";
import { BubbleSwitcher } from "@/components/nav/BubbleSwitcher";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Usuario, burbujas, perfil y textos se piden a la vez (antes iban en serie)
  const [user, spaces, t, profile] = await Promise.all([
    requireUser(), listMySpaces(), getTranslations("nav"),
    createClient().then((c) => c.from("profiles").select("discreet_mode").maybeSingle()).then((r) => r.data),
  ]);
  const active = await getActiveSpace(spaces);
  const discreet = !!profile?.discreet_mode;

  return (
    <div data-bubble={active?.kind ?? "personal"} data-discreet={discreet ? "true" : "false"} className="mx-auto min-h-dvh max-w-md pb-28">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-full focus:bg-lime focus:px-4 focus:py-3 focus:text-on-accent">{t("skip")}</a>
      <AppLock>
      <PendingExpensesProvider>
      <header className="flex items-center justify-between px-4 pt-4">
        <Logo height={24} />
        <div className="flex gap-2">
        {!user.is_anonymous && (
          <form action={toggleDiscreet}>
            <button aria-pressed={discreet} aria-label="Modo discreto" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border text-ink-2">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{discreet && <path d="M4 4l16 16" />}
              </svg>
            </button>
          </form>
        )}
        <Link href="/mas" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border text-sm text-ink-2" aria-label={t("more")}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <circle cx="5" cy="12" r="1.6" fill="currentColor" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <circle cx="19" cy="12" r="1.6" fill="currentColor" />
          </svg>
        </Link>
        </div>
      </header>
      {active && <BubbleSwitcher spaces={spaces} activeId={active.id} canCreate={!user.is_anonymous} />}
      <PendingIndicator />
      <main id="main" className="px-4">{children}</main>
      {active && <BottomNav activeSpaceId={active.id} />}
      </PendingExpensesProvider>
      </AppLock>
    </div>
  );
}
