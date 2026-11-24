import { redirect } from "next/navigation";

/** Ahorro vive ahora dentro de Plan (pestaña Ahorro). La ruta antigua redirige para no romper enlaces. */
export default function SavingsRedirect() {
  redirect("/plan?vista=ahorro");
}
