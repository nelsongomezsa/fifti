import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/ui/AuthForm";
import { safeNext } from "@/lib/validation/auth";
import { logIn } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const safe = safeNext(next);
  return (
    <>
      <h1 className="text-2xl font-bold">Entrar</h1>
      {error === "enlace" && (
        <p role="alert" className="text-sm text-over-text">El enlace no es válido o ha caducado.</p>
      )}
      <AuthForm
        action={logIn}
        next={safe}
        submit="Entrar"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Contraseña", type: "password", autoComplete: "current-password", maxLength: 128 },
        ]}
      />
      <div className="flex justify-between text-sm text-ink-2">
        <Link href="/recuperar" className="underline underline-offset-4">¿Olvidaste la contraseña?</Link>
        <Link href="/registro" className="underline underline-offset-4">Crear cuenta</Link>
      </div>
    </>
  );
}
