import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

const PROTECTED = ["/inicio", "/movimientos", "/plan", "/ahorro", "/mas", "/nueva", "/espacio", "/ingreso", "/balance", "/calendario", "/resumen-mensual", "/csv", "/tu-ano"];
const AUTH_PAGES = ["/login", "/registro", "/recuperar"];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const path = request.nextUrl.pathname;

  if (!user && matches(path, PROTECTED)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && matches(path, AUTH_PAGES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/inicio";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|icons/|brand/|apple-touch-icon.png|favicon-.*\\.png).*)"],
};
