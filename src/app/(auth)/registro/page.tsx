import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/ui/AuthForm";
import { signUp } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Crear cuenta" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">Crear cuenta</h1>
      <AuthForm
        action={signUp}
        submit="Crear cuenta"
        fields={[
          { name: "displayName", label: "Tu nombre", type: "text", autoComplete: "given-name", maxLength: 40 },
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          {
            name: "password", label: "Contraseña", type: "password", autoComplete: "new-password", maxLength: 128,
            hint: "Mínimo 12 caracteres. Comprobamos que no esté en filtraciones conocidas.",
          },
        ]}
      />
      <p className="text-sm text-ink-2">
        ¿Ya tienes cuenta? <Link href="/login" className="underline underline-offset-4">Entrar</Link>
      </p>
    </>
  );
}
