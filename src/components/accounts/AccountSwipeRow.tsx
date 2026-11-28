"use client";

import { DeleteAccountDialog } from "@/components/accounts/DeleteAccount";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useTx } from "@/i18n/tx-client";
import { archiveAccount } from "@/server/actions/accounts";

/** Fila de una cuenta propia: borrar (con su confirmación) o archivar. */
export function AccountSwipeRow({ id, name, shared, demo, children }: { id: string; name: string; shared: boolean; demo: boolean; children: React.ReactNode }) {
  const x = useTx();
  return (
    <SwipeRow id={id} name={name}
      dialog={(close) => <DeleteAccountDialog id={id} name={name} shared={shared} demo={demo} onClose={close} />}
      secondary={{ label: x("Archivar"), run: async () => (demo ? { ok: false, error: x("Crea una cuenta para guardar") } : archiveAccount({ id, archived: true })) }}>
      {children}
    </SwipeRow>
  );
}
