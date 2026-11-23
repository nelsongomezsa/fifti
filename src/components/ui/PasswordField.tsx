"use client";

import { useId, useState } from "react";
import { useTx } from "@/i18n/tx-client";

/** Campo de contraseña con botón de ojo (mostrar/ocultar). Zona táctil de 44 px, accesible por teclado y lector de pantalla. */
export function PasswordField({
  name, label, value, onChange, autoComplete, describedBy, invalid = false, maxLength = 128,
}: {
  name: string; label: string; value: string; onChange: (v: string) => void; autoComplete: "new-password" | "current-password";
  describedBy?: string; invalid?: boolean; maxLength?: number;
}) {
  const x = useTx();
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 text-sm text-ink-2">
      <label htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id} name={name} type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete} maxLength={maxLength} required spellCheck={false} autoCapitalize="none" autoCorrect="off"
          aria-describedby={describedBy} aria-invalid={invalid || undefined}
          className="min-h-12 w-full rounded-card border border-border bg-surface py-0 pl-4 pr-14 text-base text-ink"
        />
        <button
          type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown}
          aria-label={shown ? x("Ocultar contraseña") : x("Mostrar contraseña")}
          className="absolute right-0 top-0 grid size-12 min-h-11 min-w-11 place-items-center rounded-card text-ink-2"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {shown && <path d="M4 4l16 16" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
