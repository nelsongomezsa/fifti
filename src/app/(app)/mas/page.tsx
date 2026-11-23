import type { Metadata } from "next";
import { requireUser } from "@/server/spaces";
import { signOut } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Más" };

export default async function MorePage() {
  const user = await requireUser();
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">Más</h1>
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm text-ink-3">Sesión iniciada como</p>
        <p className="mt-1 break-all">{user.email}</p>
      </div>
      <form action={signOut}>
        <button type="submit" className="min-h-12 w-full rounded-full border border-border font-semibold">
          Cerrar sesión
        </button>
      </form>
    </section>
  );
}
