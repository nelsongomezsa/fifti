import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/ui/AuthForm";
import { requestPasswordReset } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Recuperar contraseña</h1>
      <AuthForm
        action={requestPasswordReset}
        submit="Enviar enlace"
        fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
      />
      <Link href="/login" className="text-sm text-ink-2 underline underline-offset-4">Volver a entrar</Link>
    </>
  );
}
