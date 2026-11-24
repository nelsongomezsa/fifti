/** Esqueleto de carga: mismo ancho y ritmo que las pantallas reales para que no salte el contenido. */
const bar = "animate-pulse rounded-card bg-track";

export function PageSkeleton({ variant = "list" }: { variant?: "home" | "list" | "plan" }) {
  return (
    <section className="flex flex-col gap-5 pt-2" aria-busy="true" aria-live="polite">
      {variant === "home" ? (
        <>
          <div><div className={`${bar} h-4 w-32`} /><div className={`${bar} mt-3 h-12 w-56`} /><div className={`${bar} mt-3 h-4 w-48`} /></div>
          <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <div key={i} className={`${bar} h-16`} />)}</div>
          <div className={`${bar} h-56`} />
          <div className={`${bar} h-40`} />
        </>
      ) : variant === "plan" ? (
        <>
          <div className={`${bar} h-8 w-32`} />
          <div className="flex gap-2"><div className={`${bar} h-11 w-24`} /><div className={`${bar} h-11 w-24`} /></div>
          <div className={`${bar} h-64`} />
        </>
      ) : (
        <>
          <div className={`${bar} h-8 w-44`} />
          <div className={`${bar} h-11`} />
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className={`${bar} h-14`} />)}
        </>
      )}
    </section>
  );
}
