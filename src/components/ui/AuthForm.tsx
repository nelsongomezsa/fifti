"use client";

import { useActionState } from "react";
import type { FormState } from "@/server/actions/auth";

type Field = { name: string; label: string; type: string; autoComplete: string; maxLength?: number; hint?: string };

export function AuthForm({
  action,
  fields,
  submit,
  next,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  if (state.ok && state.message) {
    return (
      <p role="status" className="rounded-card border border-border bg-surface p-4 text-ink-2">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1.5 text-sm text-ink-2">
          {f.label}
          <input
            name={f.name}
            type={f.type}
            autoComplete={f.autoComplete}
            maxLength={f.maxLength ?? 254}
            required
            aria-describedby={f.hint ? `${f.name}-hint` : undefined}
            className="min-h-12 rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3"
          />
          {f.hint && (
            <span id={`${f.name}-hint`} className="text-xs text-ink-3">
              {f.hint}
            </span>
          )}
        </label>
      ))}
      {state.error && (
        <p role="alert" className="text-sm text-over-text">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-full bg-lime px-6 font-semibold text-on-accent disabled:opacity-60"
      >
        {pending ? "Un momento…" : submit}
      </button>
    </form>
  );
}
