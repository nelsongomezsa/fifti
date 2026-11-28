import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 pb-10 pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <Link href="/" aria-label="Fifti, inicio">
        <Logo height={34} />
      </Link>
      {children}
    </main>
  );
}
