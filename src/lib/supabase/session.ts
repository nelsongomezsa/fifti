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

  // getUser() valida el token contra Supabase Auth (getSession() solo lee la cookie).
  const { data } = await supabase.auth.getUser();
  return { response, user: data.user };
}
