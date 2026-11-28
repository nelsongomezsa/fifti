import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SpaceKind = "personal" | "household" | "group";
export type SpaceSummary = { id: string; name: string; kind: SpaceKind; currency: string };

export const BUBBLE_COOKIE = "fifti_bubble";

/** Burbujas del usuario. RLS ya filtra: solo devuelve espacios de los que es miembro. */
export const listMySpaces = cache(async (): Promise<SpaceSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spaces")
    .select("id, name, kind, base_currency")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error("No se pudieron cargar las burbujas");
  const order: Record<SpaceKind, number> = { personal: 0, household: 1, group: 2 };
  return (data as { id: string; name: string; kind: SpaceKind; base_currency: string }[])
    .map(({ base_currency, ...s }) => ({ ...s, currency: base_currency }))
    .sort((a, b) => order[a.kind] - order[b.kind]);
});

/** Usuario de la petición. `cache` evita repetir la llamada a Auth (layout y página comparten el resultado). */
export type SessionUser = { id: string; email?: string; is_anonymous: boolean; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> };
const currentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  // Verificación local del JWT (sin viaje a Auth): suficiente para pintar pantallas; las escrituras revalidan con getUser()
  const { data } = await supabase.auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) return null;
  return {
    id: c.sub, email: typeof c.email === "string" ? c.email : undefined, is_anonymous: c.is_anonymous === true,
    app_metadata: (c.app_metadata ?? {}) as Record<string, unknown>, user_metadata: (c.user_metadata ?? {}) as Record<string, unknown>,
  };
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Burbuja activa = la de la cookie si sigue siendo del usuario; si no, la personal. */
export async function getActiveSpace(spaces: SpaceSummary[]): Promise<SpaceSummary | undefined> {
  const id = (await cookies()).get(BUBBLE_COOKIE)?.value;
  return spaces.find((s) => s.id === id) ?? spaces.find((s) => s.kind === "personal") ?? spaces[0];
}
