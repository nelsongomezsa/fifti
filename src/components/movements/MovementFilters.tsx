"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTx } from "@/i18n/tx-client";

type Opt = { id: string; name: string };

/** Filtros de Movimientos: la búsqueda se aplica en vivo mientras se escribe (con debounce); selects y etiqueta, al cambiar. */
export function MovementFilters({ month, q: q0, cat: cat0, persona: persona0, tag: tag0, cats, members }: {
  month: string; q?: string; cat?: string; persona?: string; tag?: string; cats: Opt[]; members: Opt[] | null;
}) {
  const x = useTx();
  const router = useRouter();
  const path = usePathname();
  const [, start] = useTransition();
  const [q, setQ] = useState(q0 ?? "");
  const [tag, setTag] = useState(tag0 ?? "");
  const [cat, setCat] = useState(cat0 ?? "");
  const [persona, setPersona] = useState(persona0 ?? "");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const p = new URLSearchParams({ mes: month });
      if (q.trim()) p.set("q", q.trim());
      if (cat) p.set("cat", cat);
      if (persona) p.set("persona", persona);
      if (tag.trim()) p.set("tag", tag.trim());
      start(() => router.replace(`${path}?${p.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [q, tag, cat, persona, month, path, router]);

  return (
    <form className="flex flex-wrap gap-2" role="search" onSubmit={(e) => e.preventDefault()}>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={x("Buscar")} aria-label={x("Buscar")} maxLength={50} autoComplete="off"
        className="min-h-11 flex-1 rounded-card border border-border bg-surface px-3 text-sm" />
      <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={x("Categoría")} className="min-h-11 rounded-card border border-border bg-surface px-2 text-sm">
        <option value="">{x("Categoría")}</option>
        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {members && (
        <select value={persona} onChange={(e) => setPersona(e.target.value)} aria-label={x("Persona")} className="min-h-11 rounded-card border border-border bg-surface px-2 text-sm">
          <option value="">{x("Persona")}</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}
      <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder={x("#etiqueta")} aria-label={x("Etiqueta")} maxLength={31} autoComplete="off"
        className="min-h-11 w-28 rounded-card border border-border bg-surface px-3 text-sm" />
    </form>
  );
}
