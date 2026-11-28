import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { warmIncomeRules, warmRecurring } from "@/server/currency-warm";

/** Tarea diaria (Vercel Cron): genera los gastos fijos y los ingresos que se repiten que toquen. Solo acepta el secreto del cron. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const ok = secret.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const log = (e: unknown) => console.error("[cron recurring fx]", e instanceof Error ? e.message : "error");
  await warmRecurring().catch(log);
  await warmIncomeRules().catch(log);
  const admin = createAdminClient();
  // Cada cosa por su lado: un fallo en una no deja sin hacer la otra
  const [expenses, incomes] = await Promise.all([admin.rpc("process_recurring"), admin.rpc("process_incomes")]);
  if (expenses.error || incomes.error) {
    console.error("[cron recurring]", expenses.error?.message ?? incomes.error?.message);
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
  return NextResponse.json({ created: expenses.data, incomes: incomes.data });
}
