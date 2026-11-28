import Link from "next/link";
import { getTx } from "@/i18n/tx";
import { getTranslations } from "next-intl/server";
import { AppLock } from "@/components/lock/AppLock";
import { PendingExpensesProvider } from "@/components/expense/optimistic";
import { createClient } from "@/lib/supabase/server";
import { toggleDiscreet } from "@/server/actions/prefs";
import { Logo } from "@/components/brand/Logo";
import { BottomNav } from "@/components/nav/BottomNav";
import { PendingIndicator } from "@/components/pwa/PendingIndicator";
import { DeletedNotice } from "@/components/ui/DeletedNotice";
import { BubbleSwitcher } from "@/components/nav/BubbleSwitcher";
import { SwUpdateListener } from "@/components/pwa/SwUpdateListener";
import { RefreshOnNav } from "@/components/nav/RefreshOnNav";
import { HideOn } from "@/components/nav/HideOn";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export default async function AppLayout({ children, sheet }: { children: React.ReactNode; sheet: React.ReactNode }) {
  // Usuario, burbujas, perfil y textos se piden a la vez (antes iban en serie)
  const x = await getTx();
  const [user, spaces, t, profile] = await Promise.all([
    requireUser(), listMySpaces(), getTranslations("nav"),
    createClient().then((c) => c.from("profiles").select("discreet_mode").maybeSingle()).then((r) => r.data),
  ]);
  const active = await getActiveSpace(spaces);
  const discreet = !!profile?.discreet_mode;
  const demo = user.app_metadata?.demo === true;

  return (
    <div data-bubble={active?.kind ?? "personal"} data-discreet={discreet ? "true" : "false"} className="mx-auto min-h-dvh max-w-md pb-[calc(8rem+env(safe-area-inset-bottom))]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-full focus:bg-lime focus:px-4 focus:py-3 focus:text-on-accent">{t("skip")}</a>
      {demo && (
        <div role="note" className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-1 text-xs text-ink-2">
          <span className="min-w-0">{x("Modo demo · datos ficticios")}</span>
          <span className="flex shrink-0 items-center gap-1">
            <a href="/demo/salir" className="inline-flex min-h-11 items-center px-2 text-sm text-ink-2">{x("Salir")}</a>
            <Link href="/registro" prefetch={false} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-lime px-4 text-sm font-semibold text-on-accent">{x("Crear cuenta")}</Link>
          </span>
        </div>
      )}
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
        <Link href="/ajustes" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border text-sm text-ink-2" aria-label={x("Ajustes")}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
        </div>
      </header>
      {active && <HideOn prefixes={["/ajustes"]}><BubbleSwitcher spaces={spaces} activeId={active.id} canCreate={!user.is_anonymous} /></HideOn>}
      <PendingIndicator />
      <DeletedNotice />
      <main id="main" className="px-4">{children}</main>
      {sheet}
      <RefreshOnNav />
      <SwUpdateListener />
      {active && <BottomNav activeSpaceId={active.id} />}
      </PendingExpensesProvider>
      </AppLock>
    </div>
  );
}
