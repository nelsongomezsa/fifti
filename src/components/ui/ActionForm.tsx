"use client";


import { useTx } from "@/i18n/tx-client";
import { useActionState } from "react";
import type { FormState } from "@/server/actions/auth";
import { QrCode } from "./QrCode";

/** Formulario genérico para server actions: muestra error, mensaje y (una vez) un enlace generado. */
export function ActionForm({
  action,
  children,
  submit,
  className,
  tone = "accent",
  optimistic = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children?: React.ReactNode;
  submit: string;
  className?: string;
  tone?: "accent" | "plain";
  /** Respuesta optimista: «Guardado» se ve al instante y, si el servidor falla, lo sustituye el error */
  optimistic?: boolean;
}) {
  const x = useTx();
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className ?? "flex flex-col gap-3"}>
      {children}
      {optimistic && pending && <p role="status" className="text-sm text-ink-2">✓ {x("Guardado")}</p>}
      {state.error && !pending && (
        <p role="alert" className="text-sm text-over-text">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="text-sm text-ink-2">
          {state.message}
        </p>
      )}
      {state.link && (
        <div className="rounded-card border border-border bg-bg p-3 text-sm">
          <p className="mb-1 text-ink-3">{x("Cópialo ahora: no se vuelve a mostrar.")}</p>
          <input readOnly value={state.link} aria-label={x("Enlace")} className="w-full bg-transparent font-mono text-xs text-ink" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <QrCode text={state.link} />
            <a href={`https://wa.me/?text=${encodeURIComponent(`Únete en Fifti: ${state.link}`)}`} target="_blank" rel="noopener noreferrer"
              className="min-h-11 rounded-full border border-border px-4 py-2.5 text-sm font-medium">{x("Enviar por WhatsApp")}</a>
          </div>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`min-h-11 rounded-full px-5 font-semibold disabled:opacity-60 ${
          tone === "accent" ? "bg-accent text-on-accent" : "border border-border text-ink"
        }`}
      >
        {pending && !optimistic ? x("Un momento…") : submit}
      </button>
    </form>
  );
}

export const inputClass =
  "min-h-12 w-full rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3";
