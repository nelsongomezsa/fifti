import { NextResponse, type NextRequest } from "next/server";
import { DEMO_COOKIE } from "@/lib/demo/mode";

/** Sale de la demo y vuelve a la portada. */
export function GET(request: NextRequest) {
  const res = NextResponse.redirect(new URL("/", request.url));
  res.cookies.delete(DEMO_COOKIE);
  return res;
}
