"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useTx } from "@/i18n/tx-client";
import { sheetContextChanged } from "@/lib/sheet-context";
import { deleteCategory, deleteFund, setCategoryHidden } from "@/server/actions/categories";

type Option = { id: string; name: string };
const select = "mt-3 min-h-12 w-full rounded-card border border-border bg-surface px-3 text-sm text-ink";

/** Confirmación que además pregunta adónde va lo que colgaba de lo que se borra. */
function MoveDialog({ title, description, label, options, none, onDelete, onClose }: {
  title: string; description: string; label: string; options: Option[]; none?: string;
  onDelete: (moveTo: string | null) => Promise<{ ok: boolean; error?: string }>; onClose: () => void;
}) {
  const [target, setTarget] = useState(none ? "" : options[0]?.id ?? "");
  const run = async () => {
    const r = await onDelete(target || null);
    if (r.ok) sheetContextChanged();
    return r;
  };
  return (
    <ConfirmDialog title={title} description={description} onConfirm={run} onClose={onClose}>
      <label className="mt-2 block text-xs text-ink-3">{label}
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={select}>
          {none && <option value="">{none}</option>}
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>
    </ConfirmDialog>
  );
}

/** Una categoría: las propias se borran (moviendo antes sus gastos), las de Fifti se ocultan o se muestran. */
export function CategoryRow({ id, name, system, hidden, canEdit, others }: { id: string; name: string; system: boolean; hidden: boolean; canEdit: boolean; others: Option[] }) {
  const x = useTx();
  const chip = (
    <div className="flex min-h-11 items-center justify-between gap-2 rounded-card border border-border bg-surface-2 px-3 text-sm text-ink-2">
      <span className={`truncate ${hidden ? "text-ink-3 line-through" : ""}`}>{name}</span>
      {hidden && <span className="shrink-0 text-xs text-ink-3">{x("Oculta")}</span>}
    </div>
  );
  if (!canEdit) return chip;
  return (
    <SwipeRow id={id} name={name}
      dialog={system ? undefined : (close) => (
        <MoveDialog title={`${x("¿Borrar la categoría")} «${name}»?`} description={x("Se borra la categoría. Sus gastos no se borran: pasan a la que elijas.")}
          label={x("Mover sus gastos a")} options={others} none={x("Sin categoría")} onDelete={(moveTo) => deleteCategory({ id, moveTo })} onClose={close} />
      )}
      secondary={system ? { label: hidden ? x("Mostrar") : x("Ocultar"), run: () => setCategoryHidden({ id, hidden: !hidden }) } : undefined}>
      {chip}
    </SwipeRow>
  );
}

/** Cabecera de una partida; solo las propias se pueden borrar, y sus categorías se mudan a otra. */
export function FundRow({ id, name, color, canDelete, others, children }: { id: string; name: string; color?: string; canDelete: boolean; others: Option[]; children?: React.ReactNode }) {
  const x = useTx();
  const title = children ?? (
    <h2 className="flex min-h-11 items-center gap-2 font-semibold"><span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} />{name}</h2>
  );
  if (!canDelete || others.length === 0) return title;
  return (
    <SwipeRow id={id} name={name}
      dialog={(close) => (
        <MoveDialog title={`${x("¿Borrar la partida")} «${name}»?`} description={x("Se borran la partida y su parte del reparto. Sus categorías y gastos no se borran: pasan a la que elijas.")}
          label={x("Pasar sus categorías a")} options={others} onDelete={(moveTo) => deleteFund({ id, moveTo: moveTo ?? "" })} onClose={close} />
      )}>
      {title}
    </SwipeRow>
  );
}
