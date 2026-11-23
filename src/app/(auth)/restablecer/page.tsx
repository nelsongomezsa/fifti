import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/ui/AuthForm";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function ResetPage() {
  const t = await getTranslations("auth");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=enlace");
  return (
    <>
      <h1 className="text-2xl font-bold">{t("reset")}</h1>
      <AuthForm
        action={updatePassword}
        submit={t("savePassword")}
        fields={[
          { name: "password", label: t("newPassword"), type: "password", autoComplete: "new-password", maxLength: 128,
            hint: t("minChars") },
        ]}
      />
    </>
  );
}
