import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con service_role: se salta RLS. Solo para tareas del servidor que no
 * pueden hacerse con la sesión del usuario (p. ej. rate limiting). Nunca importarlo
 * desde código de cliente; `server-only` rompe el build si ocurre.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta configuración de Supabase en el servidor");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
