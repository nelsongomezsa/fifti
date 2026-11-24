"use server";

import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import { createClient } from "@/lib/supabase/server";

export type SheetSpace = {
  id: string;
  name: string;
  kind: "personal" | "household" | "group";
  currency: string;
  meId: string;
  members: { id: string; name: string; defaultBp: number | null }[];
  categories: { id: string; name: string; fundName: string; fundColor: string }[];
  topCategoryId: string | null;
};
export type SheetFavorite = { id: string; spaceId: string; label: string; amountCents: number; categoryId: string | null };
export type SheetContext = { spaces: SheetSpace[]; favorites: SheetFavorite[]; /** La persona activó "usar IA para entender frases" */ ai?: boolean };

/** Datos para la hoja "Nuevo gasto". Todo pasa por RLS: solo burbujas del usuario. */
export async function loadSheetContext(): Promise<SheetContext> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { spaces: [], favorites: [] };
  const uid = auth.user.id;
  const x = await getTx();

  const [{ data: spaces }, { data: members }, { data: funds }, { data: cats }, { data: recent }, { data: favs }, { data: prof }] = await Promise.all([
    supabase.from("spaces").select("id, name, kind, base_currency, created_at").is("archived_at", null).order("created_at"),
    supabase.from("space_members").select("id, space_id, user_id, display_name, default_share_bp").order("joined_at"),
    supabase.from("funds").select("id, space_id, name, color, position, system_key").order("position"),
    supabase.from("categories").select("id, space_id, fund_id, name, system_key"),
    supabase.from("expenses").select("space_id, category_id").not("category_id", "is", null).order("created_at", { ascending: false }).limit(300),
    supabase.from("favorites").select("id, space_id, label, amount_cents, category_id").order("label"),
    supabase.from("profiles").select("ai_phrases").eq("id", uid).maybeSingle(),
  ]);

  const order = { personal: 0, household: 1, group: 2 } as const;
  const out: SheetSpace[] = [];
  for (const s of spaces ?? []) {
    const ms = (members ?? []).filter((m) => m.space_id === s.id);
    const me = ms.find((m) => m.user_id === uid);
    if (!me) continue;
    const fundMap = new Map((funds ?? []).filter((f) => f.space_id === s.id).map((f) => [f.id, f]));
    const categories = (cats ?? [])
      .filter((c) => c.space_id === s.id)
      .map((c) => ({ id: c.id, name: displayName(x, c.name, c.system_key), fundName: fundMap.get(c.fund_id) ? displayName(x, fundMap.get(c.fund_id)!.name, fundMap.get(c.fund_id)!.system_key) : "", fundColor: fundMap.get(c.fund_id)?.color ?? "#9AA3AF", pos: fundMap.get(c.fund_id)?.position ?? 0 }))
      .sort((a, b) => a.pos - b.pos)
      .map(({ pos: _pos, ...c }) => c);
    const counts = new Map<string, number>();
    for (const r of recent ?? []) if (r.space_id === s.id && r.category_id) counts.set(r.category_id, (counts.get(r.category_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({
      id: s.id, name: s.name, kind: s.kind, currency: s.base_currency, meId: me.id,
      members: ms.map((m) => ({ id: m.id, name: m.display_name, defaultBp: m.default_share_bp })),
      categories, topCategoryId: top,
    });
  }
  out.sort((a, b) => order[a.kind] - order[b.kind]);
  return {
    spaces: out,
    ai: !!prof?.ai_phrases,
    favorites: (favs ?? []).map((f) => ({ id: f.id, spaceId: f.space_id, label: f.label, amountCents: f.amount_cents, categoryId: f.category_id })),
  };
}
