import "server-only";
import { cookies } from "next/headers";
import { isCurrency, type Currency } from "@/lib/fx";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/server/spaces";

export const VIEW_COOKIE = "fifti_view_cur";

/** Última moneda elegida para ver los totales (por persona; en demo e invitados, por navegador). */
export async function loadViewCurrency(user: SessionUser): Promise<Currency | null> {
  let value: string | null | undefined;
  if (user.is_anonymous || user.app_metadata.demo === true) value = (await cookies()).get(VIEW_COOKIE)?.value;
  else value = (await (await createClient()).from("profiles").select("view_currency").eq("id", user.id).maybeSingle()).data?.view_currency;
  return value && isCurrency(value) ? value : null;
}
