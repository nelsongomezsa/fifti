import "server-only";

/** Los mensajes de nuestras funciones (raise exception, código P0001) son seguros de mostrar; el resto, no. */
export function rpcMessage(error: { code?: string; message?: string } | null, fallback = "No se ha podido completar la acción."): string {
  if (error?.code === "P0001" && error.message) return error.message;
  if (error) console.error("[rpc]", error.code, error.message);
  return fallback;
}
