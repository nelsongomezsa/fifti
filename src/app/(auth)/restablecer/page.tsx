import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/ui/AuthForm";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function ResetPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=enlace");
  return (
    <>
      <h1 className="text-2xl font-bold">Nueva contraseña</h1>
      <AuthForm
        action={updatePassword}
        submit="Guardar contraseña"
        fields={[
          { name: "password", label: "Contraseña nueva", type: "password", autoComplete: "new-password", maxLength: 128,
            hint: "Mínimo 12 caracteres." },
        ]}
      />
    </>
  );
}
