import { getTx } from "@/i18n/tx";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = {
  title: "Fifti · Cuentas claras en casa, en pareja y de fiesta",
  description: "Gastos personales, de pareja y de grupo conectados: tu parte de cada grupo entra sola en tu plan del mes.",
};

const BUBBLES = [
  { name: "Personal", color: "var(--lilac)", text: "Privada. Ingresos, gastos, plan del mes y metas. Solo la ves tú." },
  { name: "Hogar", color: "var(--lime)", text: "Pareja o piso: aportación proporcional a los ingresos, gastos fijos y ahorro común." },
  { name: "Plan espontáneo", color: "var(--tangerine)", text: "Una cena, un viaje. Se comparte por enlace, entran sin cuenta y al cerrar sale quién paga a quién." },
];

const DIFF = [
  ["Todo conectado", "Tu parte de cada gasto de grupo entra sola en tu plan personal: sabes lo que gastas de verdad en el mes."],
  ["Plan mensual por fondos", "Fijos, día a día, ocio, ahorro. Avisos al 80 % y al 100 %, previsión de fin de mes y cierre de mes."],
  ["Bote común justo", "Cada persona aporta según lo que gana, y el hogar se cuadra a cero cada mes."],
  ["Compensación entre grupos", "Si Leo te debe 30 € en un viaje y tú le debes 20 € en casa, se compensa con la confirmación de los dos."],
  ["Funciona sin conexión", "Apunta gastos sin cobertura: se suben solos y nunca se duplican."],
  ["Privacidad de verdad", "Gastos privados dentro de un grupo, modo discreto y bloqueo con PIN o biometría."],
];

export default async function Home() {
  const x = await getTx();
  return (
    <main>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <Logo height={30} />
        <nav aria-label={x("Cuenta")} className="flex gap-2">
          <Link href="/login" prefetch={false} className="min-h-11 rounded-full px-4 py-2.5 text-sm font-semibold text-ink-2">{x("Entrar")}</Link>
          <Link href="/registro" className="min-h-11 rounded-full border border-border px-4 py-2.5 text-sm font-semibold">{x("Crear cuenta")}</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-5xl gap-10 px-4 pb-16 pt-8 md:grid-cols-2 md:items-center">
        <div className="flex flex-col gap-6">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">{x("Cuentas claras en casa, en pareja y de fiesta.")}</h1>
          <p className="text-lg text-ink-2">{x("Fifti junta tu dinero personal, el del hogar y el de los planes con amigos en un solo sitio, sin que nadie vea lo que no debe.")}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/demo" prefetch={false} className="min-h-12 rounded-full bg-lime px-7 py-3 text-base font-semibold text-on-accent">{x("Probar la demo")}</Link>
            <Link href="/registro" className="min-h-12 rounded-full border border-border px-7 py-3 text-base font-semibold">{x("Crear cuenta")}</Link>
          </div>
          <p className="text-sm text-ink-3">{x("La demo funciona en tu navegador, con datos ficticios y sin registro.")}</p>
        </div>

        {/* Vista previa estática con los datos ficticios de la demo */}
        <div aria-hidden className="mx-auto w-full max-w-xs rounded-[28px] border border-border bg-surface p-4">
          <p className="text-xs text-ink-3">{x("Te sobra en noviembre")}</p>
          <p className="money font-mono text-4xl font-semibold">{formatMoney(31200, "EUR", x.locale)}</p>
          <div className="mt-4 flex h-24 items-end gap-2">
            {[62, 70, 55, 80, 74, 68].map((h, i) => <span key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, background: i === 5 ? "var(--lilac)" : "var(--track)" }} />)}
          </div>
          <div className="mt-4 flex flex-col gap-3 text-sm">
            {[["Gastos fijos", 94, "#9AA3AF"], ["Día a día", 83, "#7DD3FC"], ["Ocio", 111, "#FF9F43"]].map(([n, p, c]) => (
              <div key={n as string}><p className="flex justify-between"><span>{x(n as string)}</span><span className={`money font-mono ${(p as number) > 100 ? "text-over-text" : "text-ink-2"}`}>{p} %</span></p>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full" style={{ width: `${Math.min(100, p as number)}%`, background: (p as number) > 100 ? "var(--over)" : (c as string) }} /></span></div>
            ))}
          </div>
          <p className="mt-4 flex justify-between rounded-card border border-border p-3 text-sm"><span>{x("Leo → Ana")}</span><span className="money font-mono">{formatMoney(6420, "EUR", x.locale)}</span></p>
        </div>
      </section>

      <section aria-labelledby="espacios" className="border-t border-border bg-surface py-14">
        <div className="mx-auto max-w-5xl px-4">
          <h2 id="espacios" className="text-2xl font-bold">{x("Tres tipos de burbuja")}</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {BUBBLES.map((b) => (
              <li key={b.name} className="rounded-card border border-border bg-bg p-5">
                <p className="flex items-center gap-2 font-semibold"><span aria-hidden className="size-3 rounded-full" style={{ background: b.color }} />{x(b.name)}</p>
                <p className="mt-2 text-sm text-ink-2">{x(b.text)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="diferencia" className="mx-auto max-w-5xl px-4 py-14">
        <h2 id="diferencia" className="text-2xl font-bold">{x("En qué se diferencia de Tricount")}</h2>
        <p className="mt-2 max-w-2xl text-ink-2">{x("Tricount reparte gastos de un grupo. Fifti hace eso y lo conecta con tu plan del mes.")}</p>
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {DIFF.map(([t, d]) => (
            <li key={t} className="rounded-card border border-border bg-surface p-5"><p className="font-semibold">{x(t!)}</p><p className="mt-1 text-sm text-ink-2">{x(d!)}</p></li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-ink-3">
        <p>{x("Fifti · Proyecto de portfolio · Todos los datos de la demo son ficticios.")}</p>
      </footer>
    </main>
  );
}
