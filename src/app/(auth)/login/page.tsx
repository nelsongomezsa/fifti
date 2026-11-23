import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ClearLocalData } from "@/components/pwa/ClearLocalData";
import { AuthForm } from "@/components/ui/AuthForm";
import { safeNext } from "@/lib/validation/auth";
import { logIn } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const safe = safeNext(next);
  const t = await getTranslations("auth");
  return (
    <>
      <ClearLocalData />
      <h1 className="text-2xl font-bold">{t("login")}</h1>
      {error === "enlace" && (
        <p role="alert" className="text-sm text-over-text">{t("invalidLink")}</p>
      )}
      <AuthForm
        action={logIn}
        next={safe}
        submit={t("login")}
        fields={[
          { name: "email", label: t("email"), type: "email", autoComplete: "email" },
          { name: "password", label: t("password"), type: "password", autoComplete: "current-password", maxLength: 128 },
        ]}
      />
      <div className="flex justify-between text-sm text-ink-2">
        <Link href="/recuperar" className="underline underline-offset-4">{t("forgot")}</Link>
        <Link href="/registro" className="underline underline-offset-4">{t("signup")}</Link>
      </div>
    </>
  );
}
