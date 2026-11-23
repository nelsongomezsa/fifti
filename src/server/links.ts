import "server-only";
import { hashToken, isValidToken } from "@/lib/security/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

export type LinkInfo = {
  kind: "invite" | "guest" | "public_summary";
  space_name: string;
  emoji: string | null;
  space_kind: "household" | "group";
  free_members: { id: string; name: string }[];
};

/** Información mínima y pública de un enlace válido (solo servidor, vía service_role). */
export async function lookupLink(token: string): Promise<LinkInfo | null> {
  if (!isValidToken(token)) return null;
  const { data, error } = await createAdminClient().rpc("lookup_share_link", { p_token_hash: hashToken(token) });
  if (error) {
    console.error("[lookupLink]", error.message);
    return null;
  }
  return (data as LinkInfo | null) ?? null;
}
