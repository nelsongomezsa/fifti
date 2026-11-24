import "server-only";
import { notFound } from "next/navigation";
import { getTx } from "@/i18n/tx";
import { monthStart } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

/** Contexto común de las pantallas de detalle de Inicio: persona, burbuja activa y mes en curso. */
export async function detailContext() {
  const [x, user, spaces] = await Promise.all([getTx(), requireUser(), listMySpaces()]);
  const active = await getActiveSpace(spaces);
  if (!active) notFound();
  const supabase = await createClient();
  const month = monthStart(new Date());
  const monthName = new Date(`${month}T00:00:00Z`).toLocaleDateString(x.locale, { month: "long", year: "numeric", timeZone: "UTC" });
  return { x, user, active, supabase, month, monthName, today: new Date().toISOString().slice(0, 10) };
}
