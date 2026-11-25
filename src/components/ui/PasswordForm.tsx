"use client";

import { startTransition, useActionState, useState } from "react";
import { useTx } from "@/i18n/tx-client";
import { captchaReady, Turnstile } from "@/components/ui/Turnstile";
import { turnstileSiteKey } from "@/lib/turnstile-public";
import { passwordRequirements } from "@/lib/validation/auth";
import type { FormState } from "@/server/actions/auth";
import { PasswordField } from "./PasswordField";

type Field = { name: string; label: string; type: string; autoComplete: string; maxLength?: number };

function Requirement({ met, text }: { met: boolean; text: string }) {
  const x = useTx();
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={`grid size-5 place-items-center rounded-full border ${met ? "border-lime bg-lime text-on-accent" : "border-border text-transparent"}`}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      <span className={met ? "text-ink" : "text-ink-3"}>{text}</span>
      {/* El lector de pantalla anuncia el cambio de estado gracias a aria-live en la lista */}
      <span className="sr-only">{met ? x("cumplido") : x("pendiente")}</span>
    </li>
  );
}

/**
 * Formulario con contraseña nueva: repetir contraseña, ojo para mostrar/ocultar, requisitos en directo y botón
 * desactivado hasta cumplirlos. Se usa en registro, restablecer contraseña y cambiar contraseña (misma regla que el servidor).
 */
export function PasswordForm({
  action, submit, leading = [], next, withCurrent = false, clearOnSuccess = false, captcha = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  submit: string; leading?: Field[]; next?: string; withCurrent?: boolean; clearOnSuccess?: boolean;
  /** Pide el desafío de Turnstile (registro y cambio de contraseña: llaman a Supabase Auth) */
  captcha?: boolean;
}) {
  const x = useTx();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [snap, setSnap] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const r = await action(prev, fd);
    setSnap(`${fd.get("password")}\u0000${fd.get("confirmPassword")}`);
    if (r.ok && clearOnSuccess) { setCurrent(""); setPassword(""); setConfirm(""); }
    return r;
  }, {});
  const req = passwordRequirements(password, confirm);
  const mismatch = confirm.length > 0 && password !== confirm;

  if (state.ok && state.message && !clearOnSuccess) {
    return <p role="status" className="rounded-card border border-border bg-surface p-4 text-ink-2">{state.message}</p>;
  }

  return (
    <form
      className="flex flex-col gap-4"
      // Se envía a mano para que React no vacíe los campos al terminar la acción (si hay un error, la persona no tiene que reescribir)
      onSubmit={(e) => {
        e.preventDefault();
        if (captcha && !captchaReady(e.currentTarget)) return setWaiting(true);
        setWaiting(false);
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      {next && <input type="hidden" name="next" value={next} />}
      {captcha && turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} appearance="interaction-only" />}
      {waiting && <p role="status" className="text-sm text-ink-2">{x("Estamos comprobando que eres una persona. Inténtalo de nuevo en un momento.")}</p>}
      {leading.map((f) => (
        <label key={f.name} className="flex flex-col gap-1.5 text-sm text-ink-2">
          {f.label}
          <input name={f.name} type={f.type} autoComplete={f.autoComplete} maxLength={f.maxLength ?? 254} required
            className="min-h-12 rounded-card border border-border bg-surface px-4 text-base text-ink" />
        </label>
      ))}
      {withCurrent && <PasswordField name="currentPassword" label={x("Contraseña actual")} value={current} onChange={setCurrent} autoComplete="current-password" />}
      <PasswordField name="password" label={x("Contraseña")} value={password} onChange={setPassword} autoComplete="new-password" describedBy="pw-reqs" />
      <PasswordField name="confirmPassword" label={x("Repetir contraseña")} value={confirm} onChange={setConfirm} autoComplete="new-password" describedBy="pw-reqs" invalid={mismatch} />
      <ul id="pw-reqs" aria-live="polite" className="flex flex-col gap-1.5 text-sm">
        <Requirement met={req.minLength} text={x("Al menos 12 caracteres")} />
        <Requirement met={req.match} text={x("Las dos coinciden")} />
      </ul>
      {mismatch && <p className="text-sm text-over-text">{x("Las contraseñas no coinciden")}</p>}
      {state.error && snap === `${password}\u0000${confirm}` && <p role="alert" className="text-sm text-over-text">{state.error}</p>}
      {state.ok && state.message && <p role="status" className="text-sm text-ink-2">{state.message}</p>}
      <button type="submit" disabled={pending || !req.all} className="min-h-12 rounded-full bg-lime px-6 font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? x("Un momento…") : submit}
      </button>
    </form>
  );
}
