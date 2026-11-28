import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { isDemoRequest } from "@/lib/demo/mode";
import { warmRates, type RateNeed } from "@/server/fx";

type Sb = Awaited<ReturnType<typeof createClient>>;
const today = () => new Date().toISOString().slice(0, 10);

/** Monedas del Personal de cada miembro con cuenta de un espacio. Solo para pedir cambios: no sale del servidor. */
async function personalCurrencies(spaceId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: members } = await admin.from("space_members").select("user_id").eq("space_id", spaceId).not("user_id", "is", null);
  const ids = (members ?? []).map((m) => m.user_id as string);
  if (ids.length === 0) return [];
  const { data } = await admin.from("spaces").select("base_currency").eq("kind", "personal").in("created_by", ids);
  return [...new Set((data ?? []).map((s) => s.base_currency as string))];
}

/** Cambios que puede necesitar la base de datos al guardar un movimiento: reflejo en el Personal de cada miembro y cuenta en otra moneda. */
export async function warmMovement(supabase: Sb, m: { spaceId: string; userId: string; day: string; currency?: string; accountId?: string | null; movementId?: string; table?: "expenses" | "incomes" }) {
  if (await isDemoRequest()) return;
  const { data: space } = await supabase.from("spaces").select("kind, base_currency").eq("id", m.spaceId).maybeSingle();
  if (!space) return;
  const needs: RateNeed[] = [];
  if (space.kind !== "personal") for (const to of await personalCurrencies(m.spaceId)) needs.push({ from: space.base_currency, to, day: m.day });
  let accountId = m.accountId;
  if (accountId === undefined && m.movementId) accountId = (await supabase.from(m.table ?? "expenses").select("account_id").eq("id", m.movementId).maybeSingle()).data?.account_id;
  if (accountId === undefined && !m.movementId) {
    accountId = (await supabase.from("accounts").select("id").eq("space_id", m.spaceId).eq("owner_user_id", m.userId).eq("is_default", true).is("archived_at", null).maybeSingle()).data?.id;
  }
  if (accountId) {
    const { data: account } = await supabase.from("accounts").select("currency").eq("id", accountId).maybeSingle();
    if (account) needs.push({ from: m.currency ?? space.base_currency, to: account.currency, day: m.day }, { from: space.base_currency, to: account.currency, day: m.day });
  }
  await warmRates(needs);
}

/** Aportación al hogar: sale en el Personal de quien aporta, que puede estar en otra moneda. */
export async function warmContribution(supabase: Sb, spaceId: string) {
  if (await isDemoRequest()) return;
  // Con la sesión de la persona: si RLS no le deja ver el espacio, no se usa el permiso de servidor
  const { data } = await supabase.from("spaces").select("base_currency").eq("id", spaceId).maybeSingle();
  if (data) await warmRates((await personalCurrencies(spaceId)).map((to) => ({ from: data.base_currency as string, to, day: today() })));
}

/** Antes de generar los gastos fijos (tarea diaria): cambios de hoy entre las monedas de espacios y de Personales en uso. */
export async function warmRecurring() {
  const { data } = await createAdminClient().from("spaces").select("kind, base_currency").is("archived_at", null).limit(5000);
  const personal = new Set((data ?? []).filter((s) => s.kind === "personal").map((s) => s.base_currency as string));
  const shared = new Set((data ?? []).filter((s) => s.kind !== "personal").map((s) => s.base_currency as string));
  await warmRates([...shared].flatMap((from) => [...personal].map((to) => ({ from, to, day: today() }))));
}
