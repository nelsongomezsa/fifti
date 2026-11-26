import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

const PROTECTED = ["/inicio", "/movimientos", "/plan", "/ahorro", "/mas", "/nueva", "/espacio", "/ingreso", "/balance", "/calendario", "/resumen-mensual", "/csv", "/tu-ano", "/bienvenida", "/nuevo", "/atajo", "/reglas", "/compra", "/prestamos", "/tendencias", "/ajustes", "/fijos", "/aportar", "/cuentas", "/traspaso"];
const AUTH_PAGES = ["/login", "/registro", "/recuperar"];

const matches = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(`${p}/`));

// Marca de instancia: la primera petición que atiende una función recién arrancada se señala como «fría» en Server-Timing,
// para ver en las herramientas del navegador cuánto se va en el arranque y cuánto en comprobar la sesión.
const bootedAt = Date.now();
let served = 0;

export async function proxy(request: NextRequest) {
  const t0 = Date.now();
  const cold = served++ === 0;
  const { response, user } = await updateSession(request);
  response.headers.set("Server-Timing", `proxy;dur=${Date.now() - t0}, ${cold ? "cold;desc=\"instancia nueva\"" : `warm;desc=\"${Math.round((Date.now() - bootedAt) / 1000)} s de vida\"`}`);
  const path = request.nextUrl.pathname;

  const demo = request.cookies.get("fifti_demo")?.value === "1" && !request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!user && !demo && matches(path, PROTECTED)) {
    const url = request.nextUrl.clone();
    const back = request.nextUrl.pathname + request.nextUrl.search;
    url.pathname = "/login";
    url.search = back.length < 400 ? `?next=${encodeURIComponent(back)}` : "";
    return NextResponse.redirect(url);
  }
  // Quien llega a entrar o registrarse sale de la demo: así las acciones de acceso usan siempre el servicio real
  const prefetch = request.headers.has("next-router-prefetch") || (request.headers.get("sec-purpose") ?? "").includes("prefetch") || request.headers.get("purpose") === "prefetch";
  if (matches(path, AUTH_PAGES) && request.cookies.get("fifti_demo") && !prefetch) response.cookies.delete("fifti_demo");
  if (user && matches(path, AUTH_PAGES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/inicio";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/ping|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|icons/|brand/|apple-touch-icon.png|favicon-.*\\.png).*)"],
};
