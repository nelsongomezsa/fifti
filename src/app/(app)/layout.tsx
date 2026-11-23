import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BottomNav } from "@/components/nav/BottomNav";
import { BubbleSwitcher } from "@/components/nav/BubbleSwitcher";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const spaces = await listMySpaces();
  const active = await getActiveSpace(spaces);

  return (
    <div data-bubble={active?.kind ?? "personal"} className="mx-auto min-h-dvh max-w-md pb-28">
      <header className="flex items-center justify-between px-4 pt-4">
        <Logo height={24} />
        <Link href="/mas" className="grid min-h-11 min-w-11 place-items-center rounded-full border border-border text-sm text-ink-2" aria-label="Más y ajustes">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <circle cx="5" cy="12" r="1.6" fill="currentColor" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <circle cx="19" cy="12" r="1.6" fill="currentColor" />
          </svg>
        </Link>
      </header>
      {active && <BubbleSwitcher spaces={spaces} activeId={active.id} canCreate={!user.is_anonymous} />}
      <main className="px-4">{children}</main>
      {active && <BottomNav activeSpaceId={active.id} />}
    </div>
  );
}
