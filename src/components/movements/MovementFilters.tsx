"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SheetShell } from "@/components/ui/SheetShell";
import { useTx } from "@/i18n/tx-client";

type Opt = { id: string; name: string };
type Values = { tipo: string; cat: string; fondo: string; persona: string; pago: string; cuenta: string; tag: string };

/**
 * Buscador siempre visible y un botón «Filtros» que abre una hoja con todos los demás; los filtros activos se ven como chips
 * que se quitan con un toque. Todo se refleja en la URL (la búsqueda con una pequeña espera mientras se escribe).
 */
export function MovementFilters({ month, q: q0, cat: cat0, fondo: fondo0, persona: persona0, pago: pago0, tag: tag0, cuenta: cuenta0, tipo: tipo0, accounts, cats, funds, members }: {
  month: string; q?: string; cat?: string; fondo?: string; persona?: string; pago?: string; tag?: string; cuenta?: string; tipo?: string;
  accounts?: Opt[]; cats: Opt[]; funds: Opt[]; members: Opt[] | null;
}) {
  const x = useTx();
  const router = useRouter();
  const path = usePathname();
  const [, start] = useTransition();
  const [q, setQ] = useState(q0 ?? "");
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Values>({ tipo: tipo0 ?? "", cat: cat0 ?? "", fondo: fondo0 ?? "", persona: persona0 ?? "", pago: pago0 ?? "", cuenta: cuenta0 ?? "", tag: tag0 ?? "" });
  // La ruta de la lista, fijada al montar: al abrir un gasto en la hoja, la lista sigue montada y la ruta es la del detalle
  const [listPath] = useState(path);
  const applied = useRef(JSON.stringify([month, q, v]));

  // Solo se toca la URL cuando cambian los filtros, no cuando cambia la ruta
  useEffect(() => {
    const next = JSON.stringify([month, q, v]);
    if (next === applied.current) return;
    const t = setTimeout(() => {
      applied.current = next;
      const p = new URLSearchParams({ mes: month });
      if (q.trim()) p.set("q", q.trim());
      for (const [k, val] of Object.entries(v)) if (val.trim()) p.set(k, val.trim());
      start(() => router.replace(`${listPath}?${p.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
  }, [q, v, month, listPath, router]);

  const set = (k: keyof Values, val: string) => setV((o) => ({ ...o, [k]: val }));
  const nameOf = (list: Opt[] | null | undefined, id: string) => list?.find((o) => o.id === id)?.name ?? id;
  const tipoLabel: Record<string, string> = { gastos: x("Gastos"), ingresos: x("Ingresos"), traspasos: x("Traspasos") };
  const chips: { k: keyof Values; label: string }[] = [
    v.tipo && { k: "tipo" as const, label: tipoLabel[v.tipo] ?? v.tipo },
    v.fondo && { k: "fondo" as const, label: nameOf(funds, v.fondo) },
    v.cat && { k: "cat" as const, label: nameOf(cats, v.cat) },
    v.cuenta && { k: "cuenta" as const, label: v.cuenta === "none" ? x("Sin cuenta") : nameOf(accounts, v.cuenta) },
    v.pago && { k: "pago" as const, label: `${x("Pagó")} ${nameOf(members, v.pago)}` },
    v.persona && { k: "persona" as const, label: nameOf(members, v.persona) },
    v.tag.trim() && { k: "tag" as const, label: `#${v.tag.replace(/^#/, "")}` },
  ].filter(Boolean) as { k: keyof Values; label: string }[];

  const sel = "min-h-12 w-full rounded-card border border-border bg-surface px-3 text-base text-ink";
  const field = (label: string, node: React.ReactNode) => <label className="flex flex-col gap-1 text-sm text-ink-2">{label}{node}</label>;
  return (
    <div className="flex flex-col gap-2">
      <form className="flex gap-2" role="search" onSubmit={(e) => e.preventDefault()}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={x("Buscar")} aria-label={x("Buscar")} maxLength={50} autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3" />
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="min-h-11 shrink-0 rounded-full border border-border px-4 text-sm font-semibold">
          {x("Filtros")}{chips.length > 0 ? ` · ${chips.length}` : ""}
        </button>
      </form>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={x("Filtros activos")}>
          {chips.map((c) => (
            <li key={c.k}>
              <button type="button" onClick={() => set(c.k, "")} aria-label={`${x("Quitar filtro")} ${c.label}`} className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-2 px-3 text-sm">
                {c.label}<span aria-hidden className="text-ink-3">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <SheetShell onClose={() => setOpen(false)} label={x("Filtros")}>
          <h2 className="mb-3 text-xl font-bold">{x("Filtros")}</h2>
          <div className="flex flex-col gap-3">
            {field(x("Tipo"), <select value={v.tipo} onChange={(e) => set("tipo", e.target.value)} className={sel}><option value="">{x("Todo")}</option><option value="gastos">{x("Gastos")}</option><option value="ingresos">{x("Ingresos")}</option><option value="traspasos">{x("Traspasos")}</option></select>)}
            {field(x("Fondo"), <select value={v.fondo} onChange={(e) => set("fondo", e.target.value)} className={sel}><option value="">{x("Todos")}</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>)}
            {field(x("Categoría"), <select value={v.cat} onChange={(e) => set("cat", e.target.value)} className={sel}><option value="">{x("Todas")}</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
            {accounts && accounts.length > 0 && field(x("Cuenta"), <select value={v.cuenta} onChange={(e) => set("cuenta", e.target.value)} className={sel}><option value="">{x("Todas")}</option><option value="none">{x("Sin cuenta")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>)}
            {members && field(x("Quién pagó"), <select value={v.pago} onChange={(e) => set("pago", e.target.value)} className={sel}><option value="">{x("Todos")}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>)}
            {members && field(x("Persona"), <select value={v.persona} onChange={(e) => set("persona", e.target.value)} className={sel}><option value="">{x("Todas")}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>)}
            {field(x("Etiqueta"), <input value={v.tag} onChange={(e) => set("tag", e.target.value)} placeholder={x("#etiqueta")} maxLength={31} autoComplete="off" className={sel} />)}
            <div className="mt-1 flex gap-2">
              <button type="button" onClick={() => setV({ tipo: "", cat: "", fondo: "", persona: "", pago: "", cuenta: "", tag: "" })} className="min-h-12 flex-1 rounded-full border border-border font-semibold">{x("Quitar todos")}</button>
              <button type="button" onClick={() => setOpen(false)} className="min-h-12 flex-1 rounded-full bg-accent font-semibold text-on-accent">{x("Listo")}</button>
            </div>
          </div>
        </SheetShell>
      )}
    </div>
  );
}
