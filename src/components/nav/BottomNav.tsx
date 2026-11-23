"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const icons = {
  inicio: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" {...stroke} />,
  movimientos: <path d="M5 7h14M5 12h14M5 17h9" {...stroke} />,
  plan: (
    <>
      <circle cx="9" cy="13" r="5" {...stroke} />
      <circle cx="17" cy="8" r="3" {...stroke} />
    </>
  ),
  ahorro: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" {...stroke} />,
};

const items = [
  { href: "/inicio", label: "Inicio", icon: icons.inicio },
  { href: "/movimientos", label: "Movimientos", icon: icons.movimientos },
  { href: "/plan", label: "Plan", icon: icons.plan },
  { href: "/ahorro", label: "Ahorro", icon: icons.ahorro },
];

function Item({ href, label, icon, active }: { href: string; label: string; icon: React.ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
        active ? "text-ink" : "text-ink-3"
      }`}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        {icon}
      </svg>
      <span>{label}</span>
      <span aria-hidden className="h-0.5 w-5 rounded-full" style={{ background: active ? "var(--accent)" : "transparent" }} />
    </Link>
  );
}

export function BottomNav() {
  const path = usePathname();
  const on = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-md items-end">
        <Item {...items[0]!} active={on(items[0]!.href)} />
        <Item {...items[1]!} active={on(items[1]!.href)} />
        <div className="flex flex-1 justify-center">
          <Link
            href="/inicio?nuevo=gasto"
            aria-label="Añadir gasto"
            className="-mt-5 mb-2 grid size-16 place-items-center rounded-full bg-accent text-on-accent shadow-[0_0_0_6px_var(--bg)]"
          >
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </Link>
        </div>
        <Item {...items[2]!} active={on(items[2]!.href)} />
        <Item {...items[3]!} active={on(items[3]!.href)} />
      </div>
    </nav>
  );
}
