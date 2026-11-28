"use client";

import { SwipeRow } from "@/components/ui/SwipeRow";
import { useTx } from "@/i18n/tx-client";

/** Un cargo previsto de un gasto fijo: borrar quita el gasto fijo entero (y se puede deshacer); a la derecha, editarlo. */
export function ChargeRow({ recurringId, name, canEdit, children }: { recurringId?: string; name: string; canEdit: boolean; children: React.ReactNode }) {
  const x = useTx();
  if (!recurringId || !canEdit) return <>{children}</>;
  return (
    <SwipeRow id={recurringId} name={name} kind="recurring" secondary={{ label: x("Editar"), href: `/fijos/nuevo?id=${recurringId}` }}>
      {children}
    </SwipeRow>
  );
}
