import { SheetShell } from "@/components/ui/SheetShell";
import Page from "@/app/(app)/inicio/ingresos/page";

/** Misma pantalla que la página, mostrada como hoja inferior cuando se entra desde la app. */
export default function Sheet(props: Record<string, never>) {
  return <SheetShell><Page {...props} /></SheetShell>;
}
