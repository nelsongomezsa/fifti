"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useTx } from "@/i18n/tx-client";
import { sheetContextChanged } from "@/lib/sheet-context";
import { deleteSpace, leaveSpace } from "@/server/actions/space-admin";

/** Final de los ajustes de un espacio: quien lo creó puede borrarlo (escribiendo el nombre); los demás, salir. */
export function SpaceExit({ spaceId, name, owner }: { spaceId: string; name: string; owner: boolean }) {
  const x = useTx();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const run = async () => {
    sheetContextChanged(); // la copia de la hoja de «Nuevo gasto» deja de valer, salga bien o mal
    return owner ? deleteSpace({ spaceId, confirmName: typed }) : leaveSpace({ spaceId });
  };
  return (
    <>
      <button type="button" onClick={() => { setTyped(""); setOpen(true); }} aria-haspopup="dialog" className="min-h-12 w-full rounded-full border border-over font-semibold text-over-text">
        {owner ? x("Borrar este espacio") : x("Salir del espacio")}
      </button>
      {open && (
        <ConfirmDialog
          title={owner ? `${x("¿Borrar el espacio")} «${name}»?` : `${x("¿Salir del espacio")} «${name}»?`}
          description={owner
            ? x("Se borra todo lo de este espacio para todos sus miembros: gastos, ingresos, plan, metas y tus cuentas del espacio. Las cuentas de otros miembros no se borran: pasan a su espacio Personal. No se puede deshacer.")
            : x("Dejas de verlo. Lo que apuntaste se queda con tu nombre y tus cuentas propias pasan a Personal.")}
          confirmLabel={owner ? x("Borrar") : x("Salir")}
          onConfirm={run} onClose={() => setOpen(false)}>
          {owner && (
            <label className="mt-3 block text-sm text-ink-2">{x("Escribe")} «{name}» {x("para confirmar")}
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" maxLength={60} className="mt-1 min-h-12 w-full rounded-card border border-border bg-surface px-3 text-base text-ink" />
            </label>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
