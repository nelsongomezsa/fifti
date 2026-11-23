import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/ui/AuthForm";
import { requireUser, listMySpaces } from "@/server/spaces";
import { signOut, upgradeGuest } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Más" };

export default async function MorePage() {
  const user = await requireUser();
  const spaces = await listMySpaces();
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
      <form action={signOut}>
        <button type="submit" className="min-h-12 w-full rounded-full border border-border font-semibold">Cerrar sesión</button>
      </form>
    </section>
  );
}
