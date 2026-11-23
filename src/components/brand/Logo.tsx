import { LOGO_DOTS, LOGO_DOT_STROKE, LOGO_PATH, LOGO_VIEWBOX } from "./logo-data";

/** Logotipo "fifti" dibujado con trazados (no depende de la fuente). Puntos 50/50. */
export function Logo({ height = 28, className }: { height?: number; className?: string }) {
  const [, , w, h] = LOGO_VIEWBOX.split(" ").map(Number) as [number, number, number, number];
  return (
    <svg
      role="img"
      aria-label="fifti"
      viewBox={LOGO_VIEWBOX}
      height={height}
      width={(height * w) / h}
      className={className}
    >
      <path d={LOGO_PATH} fill="var(--text)" />
      {LOGO_DOTS.map((d, i) =>
        d.filled ? (
          <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="var(--lime)" />
        ) : (
          <circle
            key={i}
            cx={d.cx}
            cy={d.cy}
            r={d.r - LOGO_DOT_STROKE / 2}
            fill="none"
            stroke="var(--lime)"
            strokeWidth={LOGO_DOT_STROKE}
          />
        ),
      )}
    </svg>
  );
}
