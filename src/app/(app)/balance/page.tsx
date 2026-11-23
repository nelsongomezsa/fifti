import type { Metadata } from "next";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { CopyButton } from "@/components/ui/CopyButton";
import { addMonths, formatMoney, isMonthStart, monthStart, paymentConcept, whoPaysNext, zeroOutPayments } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { confirmOffset, deleteSettlement, proposeOffsetAction, recordSettlement, rejectOffset } from "@/server/actions/balance";
import { loadSpaceBalance } from "@/server/balance";
import { getActiveSpace, listMySpaces, requireUser } from "@/server/spaces";

export const metadata: Metadata = { title: "Balance" };

const METHODS = [["bizum", "Bizum"], ["transfer", "Transferencia"], ["cash", "Efectivo"], ["other", "Otro"]] as const;

export default async function BalancePage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const spaces = await listMySpaces();
  const active = await getActiveSpace(spaces);
  if (!active) return null;
  if (active.kind === "personal") {
    return (
      <section className="pt-2">
        <h1 className="text-2xl font-bold">Balance</h1>
        <p className="mt-3 rounded-card border border-border bg-surface p-4 text-ink-2">Tu burbuja personal no tiene deudas. Elige un hogar o un plan para ver saldos.</p>
      </section>
    );
  }
  const supabase = await createClient();
  const b = await loadSpaceBalance(supabase, active.id);
  const me = b.members.find((m) => m.user_id === user.id);
  const name = (id: string) => b.members.find((m) => m.id === id)?.display_name ?? "—";
  const next = whoPaysNext(b.balances);

  const month = sp.mes && isMonthStart(sp.mes) ? sp.mes : addMonths(monthStart(new Date()), -1);
  const zero = active.kind === "household" ? zeroOutPayments((await loadSpaceBalance(supabase, active.id, { from: month, to: addMonths(month, 1) })).balances) : [];

  // Compensación: personas con cuenta con las que compartes grupos
  const { data: offsets } = await supabase.from("cross_offsets").select("id, user_a, user_b, amount_cents, status, confirmed_a, confirmed_b").eq("status", "proposed");
  const { data: lines } = offsets?.length ? await supabase.from("cross_offset_lines").select("offset_id, space_id, from_member, to_member, amount_cents").in("offset_id", offsets.map((o) => o.id)) : { data: [] };
  const sharedUsers = new Map<string, string>();
  const { data: myM } = await supabase.from("space_members").select("space_id").eq("user_id", user.id);
  const sharedSpaceIds = (myM ?? []).map((m) => m.space_id);
  const { data: others } = sharedSpaceIds.length ? await supabase.from("space_members").select("user_id, display_name, space_id").in("space_id", sharedSpaceIds).not("user_id", "is", null).neq("user_id", user.id) : { data: [] };
  for (const o of others ?? []) if (o.user_id) sharedUsers.set(o.user_id, o.display_name);
  const { data: lineMembers } = lines?.length ? await supabase.from("space_members").select("id, display_name").in("id", lines.flatMap((l) => [l.from_member, l.to_member])) : { data: [] };
  const { data: lineSpaces } = lines?.length ? await supabase.from("spaces").select("id, name").in("id", lines.map((l) => l.space_id)) : { data: [] };

  return (
    <section className="flex flex-col gap-5 pt-2">
      <h1 className="text-2xl font-bold">Balance de {active.name}</h1>

      <ul className="flex flex-col gap-2">
        {b.members.map((m) => {
          const v = b.balances[m.id] ?? 0;
          return (
            <li key={m.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3">
              <span>{m.display_name}{m.id === me?.id ? " (tú)" : ""}</span>
              <span className={`money font-mono ${v < 0 ? "text-over-text" : ""}`}>{v > 0 ? "+" : ""}{formatMoney(v)}</span>
            </li>
          );
        })}
      </ul>

      {next && (
        <p className="rounded-card border border-border bg-surface p-4 text-sm text-ink-2">
          <span className="text-ink-3">¿Quién paga ahora? </span><strong className="text-ink">{name(next)}</strong>: es quien más debe ahora mismo.
        </p>
      )}

      <h2 className="text-lg font-semibold">Para quedar a cero</h2>
      {b.transfers.length === 0 ? (
        <p className="text-ink-2">Todo está saldado.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {b.transfers.map((t) => {
            const amount = (t.amountCents / 100).toFixed(2).replace(".", ",");
            return (
              <li key={`${t.from}-${t.to}`} className="rounded-card border border-border bg-surface p-4">
                <p className="flex items-center justify-between">
                  <span>{name(t.from)} → {name(t.to)}</span>
                  <span className="money font-mono text-lg">{formatMoney(t.amountCents)}</span>
                </p>
                {(me?.id === t.from || me?.id === t.to || me?.role === "owner") && (
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer text-sm font-semibold" style={{ color: "var(--text)" }}>Saldar</summary>
                    <p className="mt-2 text-xs text-ink-3">Fifti no mueve dinero: paga por tu app y marca aquí que está hecho.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <CopyButton text={amount} label={`Copiar ${amount}`} />
                      <CopyButton text={paymentConcept(active.name, name(t.from))} label="Copiar concepto" />
                    </div>
                    <ActionForm action={recordSettlement} submit="Marcar como pagado" className="mt-3 flex flex-col gap-2">
                      <input type="hidden" name="spaceId" value={active.id} />
                      <input type="hidden" name="from" value={t.from} /><input type="hidden" name="to" value={t.to} />
                      <input name="amount" defaultValue={amount} inputMode="decimal" aria-label="Importe" className={`${inputClass} font-mono`} />
                      <select name="method" aria-label="Método" className={inputClass}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      <input name="note" maxLength={120} placeholder="Nota (opcional)" aria-label="Nota" className={inputClass} />
                    </ActionForm>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {active.kind === "household" && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Cierre de mes: modo a cero</h2>
          <p className="text-sm text-ink-3">Pagos exactos para dejar a todos a cero con los gastos de {new Date(`${month}T00:00:00Z`).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })}.</p>
          {zero.length === 0 ? <p className="text-ink-2">Ese mes ya está a cero.</p> : (
            <ul className="flex flex-col gap-2">{zero.map((t) => (
              <li key={`${t.from}-${t.to}`} className="flex justify-between rounded-card border border-border bg-surface px-4 py-3">
                <span>{name(t.from)} → {name(t.to)}</span><span className="money font-mono">{formatMoney(t.amountCents)}</span>
              </li>))}</ul>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Compensar entre grupos</h2>
        {offsets?.length ? offsets.map((o) => {
          const iAmA = o.user_a === user.id;
          const mineConfirmed = iAmA ? o.confirmed_a : o.confirmed_b;
          const other = sharedUsers.get(iAmA ? o.user_b : o.user_a) ?? "otra persona";
          return (
            <div key={o.id} className="rounded-card border border-border bg-surface p-4 text-sm">
              <p className="font-semibold">Compensación con {other}: <span className="money font-mono">{formatMoney(o.amount_cents)}</span></p>
              <ul className="mt-2 text-ink-2">
                {lines?.filter((l) => l.offset_id === o.id).map((l, i) => (
                  <li key={i}>{lineSpaces?.find((s) => s.id === l.space_id)?.name}: {lineMembers?.find((m) => m.id === l.from_member)?.display_name} → {lineMembers?.find((m) => m.id === l.to_member)?.display_name} {formatMoney(l.amount_cents)}</li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                {mineConfirmed ? <span className="text-ink-3">Esperando a la otra persona…</span> : (
                  <form action={confirmOffset}><input type="hidden" name="offsetId" value={o.id} /><button className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent">Confirmar</button></form>
                )}
                <form action={rejectOffset}><input type="hidden" name="offsetId" value={o.id} /><button className="min-h-11 rounded-full border border-border px-5">Rechazar</button></form>
              </div>
            </div>
          );
        }) : null}
        {sharedUsers.size === 0 ? <p className="text-sm text-ink-3">Aparece cuando compartes grupos con otra persona con cuenta.</p> : [...sharedUsers.entries()].map(([uid, nm]) => (
          <ActionForm key={uid} action={proposeOffsetAction} submit={`Proponer compensación a ${nm}`} tone="plain">
            <input type="hidden" name="otherUserId" value={uid} />
          </ActionForm>
        ))}
        <p className="text-xs text-ink-3">Solo se usan los grupos que compartes con esa persona, y hace falta que los dos confirméis.</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Pagos registrados</h2>
        {b.settlements.length === 0 ? <p className="text-sm text-ink-3">Todavía no hay pagos.</p> : b.settlements.slice(0, 20).map((s) => (
          <p key={s.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
            <span>{name(s.from_member)} → {name(s.to_member)} <span className="text-xs text-ink-3">{s.method === "offset" ? "compensación" : s.method} · {s.settled_at}</span></span>
            <span className="flex items-center gap-2">
              <span className="money font-mono">{formatMoney(s.amount_cents)}</span>
              {!s.offset_id && (s.created_by === user.id || me?.role === "owner") && (
                <form action={deleteSettlement}><input type="hidden" name="settlementId" value={s.id} /><button aria-label="Borrar pago" className="min-h-11 min-w-11 text-over-text">✕</button></form>
              )}
            </span>
          </p>
        ))}
      </div>
    </section>
  );
}
