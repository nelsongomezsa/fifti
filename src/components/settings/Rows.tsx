"use client";

import Link from "next/link";
import { useState } from "react";
import { SheetShell } from "@/components/ui/SheetShell";

const ROW = "flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left transition-colors hover:bg-surface-2 active:bg-surface-2";

export function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">{children}</div>
    </section>
  );
}

const Value = ({ value }: { value?: string }) => (
  <span className="flex min-w-0 items-center gap-2 text-sm text-ink-3">{value && <span className="money truncate">{value}</span>}<span aria-hidden>›</span></span>
);

/** Fila que lleva a otra pantalla. */
export function RowLink({ href, label, value }: { href: string; label: string; value?: string }) {
  return <Link href={href} prefetch={false} className={ROW}><span>{label}</span><Value value={value} /></Link>;
}

/** Fila que abre una hoja con su contenido. */
export function RowSheet({ label, value, title, children }: { label: string; value?: string; title?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={ROW}><span>{label}</span><Value value={value} /></button>
      {open && (
        <SheetShell onClose={() => setOpen(false)} label={title ?? label}>
          <h2 className="mb-3 text-xl font-bold">{title ?? label}</h2>
          <div className="flex flex-col gap-3">{children}</div>
        </SheetShell>
      )}
    </>
  );
}
