import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthForm } from "@/components/ui/AuthForm";
import { safeNext } from "@/lib/validation/auth";
import { signUp } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const safe = safeNext((await searchParams).next);
  const t = await getTranslations("auth");
  return (
    <>
      <h1 className="text-2xl font-bold">{t("signup")}</h1>
      <AuthForm
        action={signUp}
        next={safe}
        submit={t("signup")}
        fields={[
          { name: "displayName", label: t("yourName"), type: "text", autoComplete: "given-name", maxLength: 40 },
          { name: "email", label: t("email"), type: "email", autoComplete: "email" },
          {
            name: "password", label: t("password"), type: "password", autoComplete: "new-password", maxLength: 128,
            hint: t("passwordHint"),
          },
        ]}
      />
      <p className="text-sm text-ink-2">
        {t("haveAccount")} <Link href="/login" className="underline underline-offset-4">{t("login")}</Link>
      </p>
    </>
  );
}
