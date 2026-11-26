import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hardenCookie } from "./cookie-options";

/** Refresca la sesión en cada petición y devuelve la respuesta con las cookies al día. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, hardenCookie(options));
        },
      },
    },
  );

  // getClaims() verifica la firma del JWT en local (con las claves públicas de Supabase, en caché) y refresca la sesión si caducó:
  // no hace ninguna ida y vuelta a Supabase Auth en cada navegación. Si el proyecto firmara con clave simétrica, cae a getUser().
  // Las acciones que cambian datos siguen comprobando al usuario contra Auth (getUser) en el servidor.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  return { response, user: claims?.sub ? { id: claims.sub } : null };
}
