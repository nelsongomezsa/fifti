import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

// Landing provisional: la landing completa y la demo llegan en la fase 12.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <Logo height={44} />
      <p className="text-xl text-ink-2">Cuentas claras en casa, en pareja y de fiesta.</p>
      <div className="flex gap-3">
        <Link href="/registro" className="min-h-12 rounded-full bg-lime px-6 py-3 font-semibold text-on-accent">
          Crear cuenta
        </Link>
        <Link href="/login" className="min-h-12 rounded-full border border-border px-6 py-3 font-semibold">
          Entrar
        </Link>
      </div>
    </main>
  );
}
