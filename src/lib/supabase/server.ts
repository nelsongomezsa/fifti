import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createDemoClient } from "@/lib/demo/fake-client";
import { demoDb, isDemoRequest } from "@/lib/demo/mode";
import { publicEnv } from "@/lib/env";
import { hardenCookie } from "./cookie-options";

/** Cliente con la sesión del usuario (clave anon + cookies httpOnly). Respeta RLS. */
export async function createClient() {
  const env = publicEnv();
  const store = await cookies();
  const real = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, hardenCookie(options));
        } catch {
          // Llamado desde un Server Component: el proxy ya refresca la sesión.
        }
      },
    },
  });
  // Demo: proveedor en memoria con datos ficticios y de solo lectura. No hay red ni base de datos (el cliente real ni se usa).
  if (await isDemoRequest()) return createDemoClient(demoDb()) as unknown as typeof real;
  return real;
}
