import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/ui/AuthForm";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { addFavoriteForm, deleteFavorite } from "@/server/actions/expenses";
import { requireUser, listMySpaces } from "@/server/spaces";
import { signOut, upgradeGuest } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Más" };

export default async function MorePage() {
  const user = await requireUser();
  const spaces = await listMySpaces();
  const supabase = await createClient();
  const { data: favs } = await supabase.from("favorites").select("id, label, amount_cents").order("label");
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">Más</h1>
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm text-ink-3">{user.is_anonymous ? "Sesión de invitado" : "Sesión iniciada como"}</p>
        <p className="mt-1 break-all">{user.is_anonymous ? "Sin cuenta" : user.email}</p>
      </div>

      {user.is_anonymous && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <h2 className="font-semibold">Crea tu cuenta y conserva tu historial</h2>
          <AuthForm
            action={upgradeGuest}
            submit="Crear cuenta"
            fields={[
              { name: "email", label: "Email", type: "email", autoComplete: "email" },
              { name: "password", label: "Contraseña", type: "password", autoComplete: "new-password", maxLength: 128, hint: "Mínimo 12 caracteres." },
            ]}
          />
        </div>
      )}

      <h2 className="mt-2 text-lg font-semibold">Burbujas</h2>
      <ul className="flex flex-col gap-2">
        {spaces.filter((s) => s.kind !== "personal").map((s) => (
          <li key={s.id}>
            <Link href={`/espacio/${s.id}`} className="flex min-h-12 items-center justify-between rounded-card border border-border bg-surface px-4">
              {s.name}<span aria-hidden className="text-ink-3">›</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="mt-2 text-lg font-semibold">Favoritos</h2>
      <p className="text-sm text-ink-3">Pulsación larga en el botón + para usarlos.</p>
      <ul className="flex flex-col gap-2">
        {favs?.map((f) => (
          <li key={f.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
            <span>{f.label} <span className="money font-mono text-ink-3">{formatMoney(f.amount_cents)}</span></span>
            <form action={deleteFavorite}><input type="hidden" name="favoriteId" value={f.id} /><button aria-label={`Borrar ${f.label}`} className="min-h-11 min-w-11 text-over-text">✕</button></form>
          </li>
        ))}
      </ul>
      <ActionForm action={addFavoriteForm} submit="Añadir favorito" tone="plain">
        <select name="spaceId" aria-label="Burbuja" className={inputClass}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.kind === "personal" ? "Personal" : s.name}</option>)}</select>
        <input name="label" required maxLength={30} placeholder="Café" aria-label="Nombre" className={inputClass} />
        <input name="amount" required inputMode="decimal" placeholder="2,50" aria-label="Importe" className={`${inputClass} font-mono`} />
      </ActionForm>
      <form action={signOut}>
        <button type="submit" className="min-h-12 w-full rounded-full border border-border font-semibold">Cerrar sesión</button>
      </form>
    </section>
  );
}
