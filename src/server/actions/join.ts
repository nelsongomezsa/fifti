"use server";

import { getTx } from "@/i18n/tx";

import { redirect } from "next/navigation";
import { clientIp } from "@/lib/security/ip";
import { RULES, hitIp } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { hashToken, isValidToken } from "@/lib/security/tokens";
import { createClient } from "@/lib/supabase/server";
import { guestJoinSchema } from "@/lib/validation/spaces";
import { rpcMessage } from "@/server/rpc-error";
import type { FormState } from "./auth";

const fv = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v !== "" ? v : undefined;
};

/** Entrar como invitado sin cuenta: sesión anónima ligada a un solo grupo y a un solo perfil. */
export async function joinAsGuest(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const parsed = guestJoinSchema.safeParse({ token: fv(fd, "token") ?? "", memberId: fv(fd, "memberId"), name: fv(fd, "name") });
  if (!parsed.success || !isValidToken(parsed.data.token)) return { error: x("Elige tu nombre o escribe uno.") };
  if (!(await hitIp(RULES.guestJoin))) return { error: x("Demasiados intentos. Espera un rato.") };
  // Anti-bots: sin esta comprobación no se crea ninguna sesión anónima
  if (!(await verifyTurnstile(fv(fd, "cf-turnstile-response"), await clientIp()))) return { error: x("No hemos podido verificar que eres una persona. Inténtalo de nuevo.") };

  const supabase = await createClient();
  let { data: { user } } = await supabase.auth.getUser();
  if (user && !user.is_anonymous) return { error: x("Ya tienes una cuenta: usa la invitación con tu cuenta.") };
  if (!user) {
    const res = await supabase.auth.signInAnonymously();
    if (res.error || !res.data.user) {
      console.error("[guest]", res.error?.message);
      return { error: x("No se ha podido crear la sesión de invitado.") };
    }
    user = res.data.user;
  }
  const { error } = await supabase.rpc("join_as_guest", {
    p_token_hash: hashToken(parsed.data.token), p_member: parsed.data.memberId ?? null, p_name: parsed.data.name ?? "",
  });
  if (error) {
    await supabase.auth.signOut(); // no dejamos sesiones anónimas huérfanas
    return { error: x(rpcMessage(error)) };
  }
  redirect("/inicio");
}

export async function acceptInvite(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const token = fv(fd, "token") ?? "";
  if (!isValidToken(token)) return { error: x("Enlace no válido.") };
  if (!(await hitIp(RULES.invite))) return { error: x("Demasiados intentos. Espera un rato.") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invite", { p_token_hash: hashToken(token) });
  if (error) return { error: x(rpcMessage(error)) };
  redirect("/inicio");
}

export async function claimMember(_prev: FormState, fd: FormData): Promise<FormState> {
  const x = await getTx();
  const token = fv(fd, "token") ?? "";
  if (!isValidToken(token)) return { error: x("Enlace no válido.") };
  if (!(await hitIp(RULES.claim))) return { error: x("Demasiados intentos. Espera un rato.") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_member", { p_token_hash: hashToken(token) });
  if (error) return { error: x(rpcMessage(error)) };
  redirect("/inicio");
}
