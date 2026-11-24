import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo/mode";

/** Entra en la demo: cookie sin datos personales (solo un indicador) y a Inicio. Los datos ficticios viven en memoria, en el servidor. */
export function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/inicio", request.url));
  res.cookies.set(DEMO_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 2 });
  return res;
}
