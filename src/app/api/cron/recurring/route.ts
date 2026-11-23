import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Tarea diaria (Vercel Cron): genera los gastos fijos que tocan. Solo acepta el secreto del cron. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const ok = secret.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await createAdminClient().rpc("process_recurring");
  if (error) {
    console.error("[cron recurring]", error.message);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
  return NextResponse.json({ created: data });
}
