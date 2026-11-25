"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTx } from "@/i18n/tx-client";

type Opt = { id: string; name: string };

/** Filtros de Movimientos: búsqueda en vivo (con debounce); fondo, categoría, persona, quién pagó y etiqueta se aplican al cambiar. */
export function MovementFilters({ month, q: q0, cat: cat0, fondo: fondo0, persona: persona0, pago: pago0, tag: tag0, cuenta: cuenta0, accounts, cats, funds, members }: {
  month: string; q?: string; cat?: string; fondo?: string; persona?: string; pago?: string; tag?: string; cuenta?: string; accounts?: Opt[]; cats: Opt[]; funds: Opt[]; members: Opt[] | null;
}) {
  const x = useTx();
  const router = useRouter();
  const path = usePathname();
  const [, start] = useTransition();
  const [q, setQ] = useState(q0 ?? "");
  const [tag, setTag] = useState(tag0 ?? "");
  const [cat, setCat] = useState(cat0 ?? "");
  const [fondo, setFondo] = useState(fondo0 ?? "");
  const [persona, setPersona] = useState(persona0 ?? "");
  const [pago, setPago] = useState(pago0 ?? "");
  const [cuenta, setCuenta] = useState(cuenta0 ?? "");
  const first = useRef(true);
  const active = [q.trim(), cat, fondo, persona, pago, cuenta, tag.trim()].filter(Boolean).length;

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const p = new URLSearchParams({ mes: month });
      if (q.trim()) p.set("q", q.trim());
      if (cat) p.set("cat", cat);
      if (fondo) p.set("fondo", fondo);
      if (persona) p.set("persona", persona);
      if (pago) p.set("pago", pago);
      if (cuenta) p.set("cuenta", cuenta);
      if (tag.trim()) p.set("tag", tag.trim());
      start(() => router.replace(`${path}?${p.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [q, tag, cat, fondo, persona, pago, cuenta, month, path, router]);

  const sel = "min-h-11 min-w-0 flex-1 rounded-card border border-border bg-surface px-2 text-sm";
  return (
    <form className="flex flex-col gap-2" role="search" onSubmit={(e) => e.preventDefault()}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={x("Buscar")} aria-label={x("Buscar")} maxLength={50} autoComplete="off" className="min-h-11 w-full rounded-card border border-border bg-surface px-3 text-sm" />
      <div className="flex gap-2">
        <select value={fondo} onChange={(e) => setFondo(e.target.value)} aria-label={x("Fondo")} className={sel}><option value="">{x("Fondo")}</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={x("Categoría")} className={sel}><option value="">{x("Categoría")}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      {accounts && accounts.length > 0 && (
        <div className="flex gap-2">
          <select value={cuenta} onChange={(e) => setCuenta(e.target.value)} aria-label={x("Cuenta")} className={sel}>
            <option value="">{x("Cuenta")}</option><option value="none">{x("Sin cuenta")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}
      <div className="flex gap-2">
        {members && <select value={pago} onChange={(e) => setPago(e.target.value)} aria-label={x("Quién pagó")} className={sel}><option value="">{x("Quién pagó")}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        {members && <select value={persona} onChange={(e) => setPersona(e.target.value)} aria-label={x("Persona")} className={sel}><option value="">{x("Persona")}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={x("#etiqueta")} aria-label={x("Etiqueta")} maxLength={31} autoComplete="off" className={`${sel} ${members ? "max-w-28" : ""}`} />
      </div>
      {active > 0 && <button type="button" onClick={() => { setQ(""); setCat(""); setFondo(""); setPersona(""); setPago(""); setTag(""); }} className="min-h-11 self-start px-2 text-sm text-ink-2 underline-offset-4 hover:underline">{x("Quitar filtros")} ({active})</button>}
    </form>
  );
}
