import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";

/** Exporta los gastos de una burbuja a CSV (con escape de inyección de fórmulas). Mismo origen: sin cabeceras CORS. */
export async function GET(request: NextRequest) {
  const spaceId = uuidSchema.safeParse(new URL(request.url).searchParams.get("space"));
  if (!spaceId.success) return NextResponse.json({ error: "Solicitud no válida" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await allow(RULES.importCsv, auth.user.id))) return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });

  const { data: space } = await supabase.from("spaces").select("name").eq("id", spaceId.data).maybeSingle();
  if (!space) return NextResponse.json({ error: "No encontrado" }, { status: 404 }); // RLS: no eres miembro
  const [{ data: ex }, { data: cats }, { data: priv }] = await Promise.all([
    supabase.from("expenses").select("id, spent_at, description, amount_cents, currency, category_id, is_private").eq("space_id", spaceId.data).order("spent_at").limit(5000),
    supabase.from("categories").select("id, name").eq("space_id", spaceId.data),
    supabase.from("expense_private_details").select("expense_id, description"),
  ]);
  const cat = new Map((cats ?? []).map((c) => [c.id, c.name]));
  const mine = new Map((priv ?? []).map((p) => [p.expense_id, p.description]));
  const rows: (string | number)[][] = [["fecha", "concepto", "importe", "moneda", "categoria"]];
  for (const e of ex ?? []) {
    rows.push([e.spent_at, e.is_private ? (mine.get(e.id) ?? "Gasto privado") : e.description, (e.amount_cents / 100).toFixed(2).replace(".", ","), e.currency, e.category_id ? (cat.get(e.category_id) ?? "") : ""]);
  }
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fifti-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
