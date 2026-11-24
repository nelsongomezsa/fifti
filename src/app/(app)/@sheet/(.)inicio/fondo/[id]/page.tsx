import { SheetShell } from "@/components/ui/SheetShell";
import Page from "@/app/(app)/inicio/fondo/[id]/page";

/** Misma pantalla que la página, mostrada como hoja inferior cuando se entra desde la app. */
export default function Sheet(props: { params: Promise<{ id: string }> }) {
  return <SheetShell><Page {...props} /></SheetShell>;
}
