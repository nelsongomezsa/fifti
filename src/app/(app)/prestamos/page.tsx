import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { getTx } from "@/i18n/tx";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { createLoan, deleteLoan, repayLoan } from "@/server/actions/loans";
import { loadLoans, loanTotals } from "@/server/loans";
import { requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Préstamos" };

export default async function LoansPage() {
  const x = await getTx();
  const user = await requireUser();
  const back = <Link href="/mas" className="min-h-11 self-start text-sm text-ink-2">{x("‹ Más")}</Link>;
  if (user.is_anonymous) return <section className="flex flex-col gap-4 pt-2">{back}<p className="text-ink-2">{x("Necesitas una cuenta.")}</p></section>;
  const supabase = await createClient();
  const [rows, { data: mem }] = await Promise.all([
    loadLoans(supabase, user.id),
    supabase.from("space_members").select("user_id, display_name").not("user_id", "is", null).neq("user_id", user.id),
  ]);
  const people = [...new Map((mem ?? []).map((m) => [m.user_id as string, m.display_name])).entries()];
  const t = loanTotals(rows);
  const fmt = (c: number) => formatMoney(c, "EUR", x.locale);
  const today = new Date().toISOString().slice(0, 10);
  const open = rows.filter((r) => r.remainingCents > 0), closed = rows.filter((r) => r.remainingCents === 0);

  const item = (r: (typeof rows)[number]) => (
    <li key={r.id} className="rounded-card border border-border bg-surface p-3">
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span className="min-w-0"><span className="block truncate font-medium">{r.direction === "lent" ? x("Le dejé a") : x("Me dejó")} {r.personName}</span>
            <span className="text-xs text-ink-3">{new Date(`${r.loanDate}T00:00:00Z`).toLocaleDateString(x.locale, { day: "numeric", month: "short", timeZone: "UTC" })}
              {r.remindOn && r.remainingCents > 0 && r.remindOn <= today && <span className="ml-2 text-warn">{x("Toca recordarlo")}</span>}
              {!r.mine && <span className="ml-2">{x("Compartido contigo")}</span>}</span></span>
          <span className="money shrink-0 font-mono">{r.remainingCents > 0 ? fmt(r.remainingCents) : x("Devuelto")}</span>
        </summary>
        <div className="mt-2 flex flex-col gap-3 text-sm">
          <p className="text-ink-2">{x("Total prestado")}: <span className="money font-mono">{fmt(r.amountCents)}</span>{r.note ? ` · ${r.note}` : ""}</p>
          {r.mine && r.remainingCents > 0 && (
            <ActionForm action={repayLoan} submit={x("Apuntar devolución")} tone="plain" className="flex flex-col gap-2">
              <input type="hidden" name="loanId" value={r.id} />
              <input name="amount" inputMode="decimal" defaultValue={(r.remainingCents / 100).toFixed(2).replace(".", ",")} aria-label={x("Importe devuelto")} className={`${inputClass} font-mono`} />
              <p className="text-xs text-ink-3">{x("Pon menos para una devolución parcial.")}</p>
            </ActionForm>
          )}
          {r.mine && <form action={deleteLoan}><input type="hidden" name="loanId" value={r.id} /><button className="min-h-11 rounded-full border border-border px-5 font-semibold text-over-text">{x("Borrar préstamo")}</button></form>}
        </div>
      </details>
    </li>
  );

  return (
    <section className="flex flex-col gap-4 pt-2">
      {back}
      <h1 className="text-2xl font-bold">{x("Préstamos")}</h1>
      <p className="text-sm text-ink-2">{x("Lo que has dejado o te han dejado. Es privado: solo lo ves tú, salvo que lo compartas con alguien de tus burbujas.")}</p>
      <p className="money font-mono text-lg">{x("Te deben")} {fmt(t.owedToMe)} · {x("Debes")} {fmt(t.iOwe)}</p>
      {open.length === 0 ? <EmptyState title={x("No hay préstamos pendientes")} text={x("Apunta lo que dejas o te dejan y Fifti te recuerda lo que falta por devolver, sin mezclarlo con tus gastos.")} actionLabel={x("Apuntar un préstamo")} href="#nuevo-prestamo" /> : <ul className="flex flex-col gap-2">{open.map(item)}</ul>}
      {closed.length > 0 && <details><summary className="min-h-11 cursor-pointer py-2 text-sm text-ink-3">{x("Devueltos")} ({closed.length})</summary><ul className="mt-2 flex flex-col gap-2">{closed.map(item)}</ul></details>}

      <h2 className="text-lg font-semibold">{x("Apuntar un préstamo")}</h2>
      <div id="nuevo-prestamo" className="scroll-mt-4 rounded-card border border-border bg-surface p-4">
        <ActionForm action={createLoan} submit={x("Guardar préstamo")} className="flex flex-col gap-3">
          <select name="direction" defaultValue="lent" aria-label={x("Tipo")} className={inputClass}><option value="lent">{x("Le dejé dinero")}</option><option value="borrowed">{x("Me dejaron dinero")}</option></select>
          <input name="personName" required maxLength={40} placeholder={x("Marta")} aria-label={x("Persona")} className={inputClass} />
          {people.length > 0 && (
            <select name="linkedUserId" defaultValue="" aria-label={x("Vincular con alguien de tus burbujas")} className={inputClass}>
              <option value="">{x("Sin vincular")}</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          <input name="amount" required inputMode="decimal" placeholder="50,00" aria-label={x("Importe")} className={`${inputClass} font-mono`} />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-3">{x("Fecha")}<input type="date" name="loanDate" defaultValue={today} className={inputClass} /></label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">{x("Recordar el (opcional)")}<input type="date" name="remindOn" className={inputClass} /></label>
          </div>
          <input name="note" maxLength={80} placeholder={x("Nota (opcional)")} aria-label={x("Nota")} className={inputClass} />
          {people.length > 0 && <label className="flex min-h-11 items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="shared" value="1" className="size-5" />{x("Compartirlo con esa persona (solo si la has vinculado)")}</label>}
        </ActionForm>
      </div>
    </section>
  );
}
