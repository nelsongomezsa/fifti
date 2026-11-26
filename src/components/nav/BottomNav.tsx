"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { PlusButton } from "./PlusButton";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
export const NAV_ICONS = {
  inicio: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" {...stroke} />,
  movimientos: <path d="M5 7h14M5 12h14M5 17h9" {...stroke} />,
  calendario: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" {...stroke} />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" {...stroke} />
    </>
  ),
  plan: (
    <>
      <circle cx="9" cy="13" r="5" {...stroke} />
      <circle cx="17" cy="8" r="3" {...stroke} />
    </>
  ),
};

const items = [
  { href: "/inicio", id: "home", icon: NAV_ICONS.inicio },
  { href: "/movimientos", id: "movements", icon: NAV_ICONS.movimientos },
  { href: "/calendario", id: "calendar", icon: NAV_ICONS.calendario },
  { href: "/plan", id: "plan", icon: NAV_ICONS.plan },
] as const;

function Item({ href, label, icon, active }: { href: string; label: string; icon: React.ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      prefetch
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-[13px] font-medium ${
        active ? "text-ink" : "text-ink-3"
      }`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        {icon}
      </svg>
      <span className="max-w-full truncate">{label}</span>
      <span aria-hidden className="h-0.5 w-5 rounded-full" style={{ background: active ? "var(--accent)" : "transparent" }} />
    </Link>
  );
}

export function BottomNav({ activeSpaceId }: { activeSpaceId: string }) {
  const path = usePathname();
  const router = useRouter();
  // Precarga de las rutas de la barra (y Balance/Más) cuando el navegador está libre
  useEffect(() => {
    const go = () => { for (const h of ["/inicio", "/movimientos", "/calendario", "/plan", "/ajustes"]) router.prefetch(h); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(go); else setTimeout(go, 500);
  }, [router]);
  const t = useTranslations("nav");
  const on = (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/plan" && path.startsWith("/ahorro"));
  return (
    <nav
      aria-label={t("main")}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end">
        <Item {...items[0]!} label={t(items[0]!.id)} active={on(items[0]!.href)} />
        <Item {...items[1]!} label={t(items[1]!.id)} active={on(items[1]!.href)} />
        <div className="flex min-w-0 justify-center">
          <PlusButton activeSpaceId={activeSpaceId} />
        </div>
        <Item {...items[2]!} label={t(items[2]!.id)} active={on(items[2]!.href)} />
        <Item {...items[3]!} label={t(items[3]!.id)} active={on(items[3]!.href)} />
      </div>
    </nav>
  );
}
