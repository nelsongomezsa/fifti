import "server-only";
import { createHash } from "node:crypto";

/**
 * Comprueba la contraseña en Have I Been Pwned por k-anonymity: solo se envían
 * los 5 primeros caracteres del SHA-1; la contraseña nunca sale del servidor.
 * Devuelve las veces que aparece (0 = no filtrada). Si el servicio falla, devuelve
 * null (no bloqueamos el registro por una caída de un tercero) y queda en logs.
 */
export async function pwnedCount(password: string): Promise<number | null> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HIBP ${res.status}`);
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hash, count] = line.trim().split(":");
      if (hash === suffix) return Number(count) || 0;
    }
    return 0;
  } catch (err) {
    console.error("[hibp]", err instanceof Error ? err.message : "error");
    return null;
  }
}
