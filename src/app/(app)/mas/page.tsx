import { redirect } from "next/navigation";

/** «Más» pasó a ser Ajustes (el engranaje de la cabecera). La ruta antigua redirige para no romper enlaces. */
export default function MoreRedirect() {
  redirect("/ajustes");
}
