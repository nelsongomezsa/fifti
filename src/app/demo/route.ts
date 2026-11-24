import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo/mode";

/** Entra en la demo: cookie sin datos personales (solo un indicador) y a Inicio. Los datos ficticios viven en memoria, en el servidor. */
export function GET(request: NextRequest) {
  // Una precarga del enlace no debe activar la demo (ni poner cookies): solo la navegación real
  if (request.headers.has("next-router-prefetch") || (request.headers.get("sec-purpose") ?? "").includes("prefetch")) return new NextResponse(null, { status: 204 });
  const res = NextResponse.redirect(new URL("/inicio", request.url));
  res.cookies.set(DEMO_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 2 });
  return res;
}
