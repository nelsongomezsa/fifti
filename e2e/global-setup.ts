import { admin, e2eConfigured } from "./helpers";

/** Antes de empezar se vacían los contadores de límite de intentos de la base de datos de pruebas (cada ejecución parte limpia). */
export default async function globalSetup() {
  if (!e2eConfigured) return;
  await admin().from("rate_limits").delete().neq("key", "");
}
