import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { addVirtualMember, createClaimLink, createLink, kickMember, revokeLink, saveShares } from "@/server/actions/spaces";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/spaces";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Ajustes de burbuja" };

const pct = (bp: number | null) => (bp === null ? "" : (bp / 100).toFixed(2).replace(".", ","));

export default async function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const user = await requireUser();
  const supabase = await createClient();

  // RLS: si no eres miembro, no hay fila (mismo resultado que si no existiera).
  const { data: space } = await supabase.from("spaces").select("id, name, kind, emoji, base_currency").eq("id", id).maybeSingle();
  if (!space) notFound();
  const { data: members } = await supabase
    .from("space_members").select("id, user_id, display_name, role, default_share_bp").eq("space_id", id).order("joined_at");
  const mine = members?.find((m) => m.user_id === user.id);
  const isOwner = mine?.role === "owner";
  const { data: links } = isOwner
    ? await supabase.from("share_links").select("id, kind, expires_at, max_uses, uses, revoked").eq("space_id", id).order("created_at", { ascending: false }).limit(20)
    : { data: [] };

  const roleLabel = { owner: "Propietario", member: "Miembro", guest: "Invitado" } as const;

  return (
    <section className="flex flex-col gap-6 pt-2">
      <h1 className="text-2xl font-bold">{space.name}</h1>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Miembros</h2>
        <ul className="flex flex-col gap-2">
          {members?.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3">
              <span>
                {m.display_name}
                <span className="ml-2 text-xs text-ink-3">
                  {m.user_id ? roleLabel[m.role as keyof typeof roleLabel] : "Sin cuenta"}
                </span>
              </span>
              {isOwner && m.role !== "owner" && m.user_id && (
                <form action={kickMember}>
                  <input type="hidden" name="memberId" value={m.id} />
                  <input type="hidden" name="spaceId" value={id} />
                  <button className="min-h-11 px-3 text-sm text-over-text">Expulsar</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </div>

      {isOwner && (
        <>
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Añadir persona sin cuenta</h2>
            <ActionForm action={addVirtualMember} submit="Añadir" tone="plain">
              <input type="hidden" name="spaceId" value={id} />
              <input name="name" required maxLength={40} placeholder="Nombre" aria-label="Nombre" className={inputClass} />
            </ActionForm>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Porcentaje por defecto</h2>
            <ActionForm action={saveShares} submit="Guardar porcentajes" tone="plain">
              <input type="hidden" name="spaceId" value={id} />
              {members?.map((m) => (
                <label key={m.id} className="flex items-center justify-between gap-3 text-sm text-ink-2">
                  {m.display_name}
                  <span className="flex items-center gap-2">
                    <input name={`bp_${m.id}`} defaultValue={pct(m.default_share_bp)} inputMode="decimal"
                      className="min-h-11 w-24 rounded-card border border-border bg-surface px-3 text-right font-mono text-ink" />
                    %
                  </span>
                </label>
              ))}
            </ActionForm>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Enlaces</h2>
            <ActionForm action={createLink} submit="Crear enlace">
              <input type="hidden" name="spaceId" value={id} />
              <select name="kind" className={inputClass} defaultValue={space.kind === "group" ? "guest" : "invite"} aria-label="Tipo de enlace">
                <option value="invite">Invitar con cuenta</option>
                {space.kind === "group" && <option value="guest">Entrar como invitado (sin cuenta)</option>}
                <option value="public_summary">Resumen público (solo lectura)</option>
              </select>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-ink-3">Caduca en (días)
                  <input name="days" type="number" min={1} max={90} defaultValue={7} className={inputClass} /></label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">Usos máximos
                  <input name="maxUses" type="number" min={1} max={1000} defaultValue={10} className={inputClass} /></label>
              </div>
            </ActionForm>
            <ul className="flex flex-col gap-2">
              {links?.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
                  <span className="text-ink-2">
                    {l.kind === "invite" ? "Invitación" : l.kind === "guest" ? "Invitado" : "Resumen"} · {l.uses}/{l.max_uses}
                    <span className="block text-xs text-ink-3">
                      {l.revoked ? "Revocado" : new Date(l.expires_at) < new Date() ? "Caducado" : `Caduca ${new Date(l.expires_at).toLocaleDateString("es-ES")}`}
                    </span>
                  </span>
                  {!l.revoked && (
                    <form action={revokeLink}>
                      <input type="hidden" name="linkId" value={l.id} />
                      <input type="hidden" name="spaceId" value={id} />
                      <button className="min-h-11 px-3 text-over-text">Revocar</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {members?.some((m) => !m.user_id) && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Reclamar perfil</h2>
              <p className="text-sm text-ink-3">Genera un enlace para que una persona sin cuenta se quede con su perfil e historial.</p>
              {members.filter((m) => !m.user_id).map((m) => (
                <ActionForm key={m.id} action={createClaimLink} submit={`Enlace para ${m.display_name}`} tone="plain">
                  <input type="hidden" name="memberId" value={m.id} />
                </ActionForm>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
