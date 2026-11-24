import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { addMonths, formatMoney, isMonthStart, monthStart } from "@/lib/money";
import { buildReportPdf } from "@/lib/report-pdf";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { displayName } from "@/lib/system-names";
import { createClient } from "@/lib/supabase/server";
import { loadSpaceBalance } from "@/server/balance";
import { loadOverview } from "@/server/overview";

const query = z.object({ space: z.uuid(), mes: z.string().refine(isMonthStart).optional() }).strict();

/** Informe mensual en PDF de UNA burbuja y solo con lo que la persona que lo pide puede ver (RLS). */
export async function GET(request: NextRequest) {
  const x = await getTx();
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: x("Datos no válidos") }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || auth.user.is_anonymous) return NextResponse.json({ error: x("Necesitas una cuenta.") }, { status: 401 });
  if (!(await allow(RULES.report, auth.user.id))) return NextResponse.json({ error: x("Demasiados intentos. Espera un rato.") }, { status: 429 });

  const { data: space } = await supabase.from("spaces").select("id, name, kind").eq("id", parsed.data.space).maybeSingle();
  if (!space) return NextResponse.json({ error: x("No encontramos esa burbuja.") }, { status: 404 });
  const month = parsed.data.mes ?? addMonths(monthStart(new Date()), -1);
  const kind = space.kind as "personal" | "household" | "group";

  const [o, { data: rows }, { data: cats }, balance] = await Promise.all([
    loadOverview(supabase, space.id, kind, month, addMonths(month, 1), x.locale),
    supabase.rpc("monthly_breakdown", { p_space: space.id, p_from: month }),
    supabase.from("categories").select("id, name, system_key").eq("space_id", space.id),
    kind === "personal" ? Promise.resolve(null) : loadSpaceBalance(supabase, space.id),
  ]);
  const catName = (id: string | null) => { const c = cats?.find((k) => k.id === id); return c ? displayName(x, c.name, c.system_key) : x("Sin categoría"); };
  const top = ((rows ?? []) as { month: string; category_id: string | null; total_cents: number }[])
    .filter((r) => r.month === month).sort((a, b) => Number(b.total_cents) - Number(a.total_cents)).slice(0, 6).map((r) => ({ name: catName(r.category_id), cents: Number(r.total_cents) }));
  const nm = (id: string) => balance?.members.find((m) => m.id === id)?.display_name ?? "—";
  const monthLabel = new Date(`${month}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const bubble = kind === "personal" ? x("Personal") : space.name;

  const bytes = await buildReportPdf({
    title: x("Informe mensual"), bubble, monthLabel, generated: new Date().toLocaleDateString(x.locale, { day: "numeric", month: "short", year: "numeric" }),
    labels: { income: x("Ingresos"), spent: x("Gasto"), leftover: x("Te sobró"), savingsRate: x("Tasa de ahorro"), funds: x("Fondos"), planned: x("Previsto"), real: x("Real"), topCategories: x("Mayores categorías"), balance: x("Balance"), balanceNote: x("Saldo actual de la burbuja."), noData: x("Sin datos este mes."), pays: x("paga a"), allSettled: x("Todo saldado."), footer: x("Generado con Fifti") },
    money: (c) => formatMoney(c, "EUR", x.locale),
    income: o.income, spent: o.spent, leftover: o.leftover, savingsBp: o.savingsBp,
    funds: o.funds.filter((f) => f.planned > 0 || f.spent > 0).map((f) => ({ name: f.name, color: f.color, planned: f.planned, spent: f.spent, usedBp: f.usedBp })),
    categories: top,
    balance: balance ? { members: balance.members.map((m) => ({ name: m.display_name, cents: balance.balances[m.id] ?? 0 })), transfers: balance.transfers.map((t) => ({ from: nm(t.from), to: nm(t.to), cents: t.amountCents })) } : null,
  });
  const slug = kind === "personal" ? "personal" : space.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "burbuja";
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="fifti-${month.slice(0, 7)}-${slug}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
