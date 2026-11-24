import Link from "next/link";

/** Estado vacío: explica para qué sirve la pantalla y ofrece la acción principal. */
export function EmptyState({ title, text, actionLabel, href, children }: { title: string; text: string; actionLabel?: string; href?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface p-6 text-center">
      <p className="font-semibold">{title}</p>
      <p className="max-w-xs text-sm text-ink-2">{text}</p>
      {actionLabel && href && <Link href={href} className="inline-flex min-h-12 items-center rounded-full bg-accent px-6 font-semibold text-on-accent">{actionLabel}</Link>}
      {children}
    </div>
  );
}
