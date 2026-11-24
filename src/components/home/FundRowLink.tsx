import Link from "next/link";

/**
 * Fila de un fondo en Inicio: el punto y la barra llevan SIEMPRE el color del fondo, y la barra ocupa todo el ancho hasta el porcentaje.
 * El estado (80 % / pasado) se dice con el texto del porcentaje y con texto para lectores de pantalla, no con otro color de barra.
 */
export function FundRowLink({ href, name, color, usedBp, status, savings, statusText }: { href: string; name: string; color: string; usedBp: number; status: "ok" | "warn" | "over"; savings?: boolean; statusText: string }) {
  const pct = Math.round(usedBp / 100);
  const tone = savings ? "text-ink-2" : status === "over" ? "text-over-text" : status === "warn" ? "text-warn" : "text-ink-2";
  return (
    <Link href={href} className="block px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm"><span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} /><span className="truncate">{name}</span></span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={`money font-mono text-sm ${tone}`}>{pct} %<span className="sr-only">{status !== "ok" && !savings ? ` — ${statusText}` : ""}</span></span>
          <span aria-hidden className="text-ink-3">›</span>
        </span>
      </span>
      <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-track" role="presentation">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, usedBp / 100))}%`, background: color }} />
      </span>
    </Link>
  );
}
