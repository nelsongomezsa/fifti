import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthForm } from "@/components/ui/AuthForm";
import { requestPasswordReset } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default async function RecoverPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <h1 className="text-2xl font-bold">{t("recover")}</h1>
      <AuthForm
        action={requestPasswordReset}
        submit={t("sendLink")}
        fields={[{ name: "email", label: t("email"), type: "email", autoComplete: "email" }]}
      />
      <Link href="/login" className="text-sm text-ink-2 underline underline-offset-4">{t("backToLogin")}</Link>
    </>
  );
}
