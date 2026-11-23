import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SpaceKind = "personal" | "household" | "group";
export type SpaceSummary = { id: string; name: string; kind: SpaceKind };

export const BUBBLE_COOKIE = "fifti_bubble";

/** Burbujas del usuario. RLS ya filtra: solo devuelve espacios de los que es miembro. */
export async function listMySpaces(): Promise<SpaceSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spaces")
    .select("id, name, kind")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error("No se pudieron cargar las burbujas");
  const order: Record<SpaceKind, number> = { personal: 0, household: 1, group: 2 };
  return (data as SpaceSummary[]).sort((a, b) => order[a.kind] - order[b.kind]);
}

export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return data.user;
}

/** Burbuja activa = la de la cookie si sigue siendo del usuario; si no, la personal. */
export async function getActiveSpace(spaces: SpaceSummary[]): Promise<SpaceSummary | undefined> {
  const id = (await cookies()).get(BUBBLE_COOKIE)?.value;
  return spaces.find((s) => s.id === id) ?? spaces.find((s) => s.kind === "personal") ?? spaces[0];
}
