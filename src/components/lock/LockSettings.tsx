"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createBiometric, hashPin, PIN_RE, readLock, writeLock } from "@/lib/applock";

export function LockSettings() {
  const t = useTranslations("lock");
  const [lock, setLock] = useState(() => (typeof window === "undefined" ? null : readLock()));
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const savePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PIN_RE.test(pin)) return setMsg(t("setPin"));
    const next = { ...(readLock() ?? {}), pin: await hashPin(pin) };
    writeLock(next); setLock(next); setPin(""); setMsg(null);
  };
  const addBio = async () => {
    const id = await createBiometric().catch(() => null);
    if (!id) return setMsg("No disponible en este dispositivo.");
    const next = { ...(readLock() ?? {}), cred: id };
    writeLock(next); setLock(next); setMsg(null);
  };

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 text-sm">
      <p className="text-ink-3">{t("note")}</p>
      <form onSubmit={savePin} className="flex gap-2">
        <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          aria-label={t("setPin")} placeholder={t("setPin")} className="min-h-12 flex-1 rounded-card border border-border bg-surface-2 px-4 font-mono text-ink" />
        <button className="min-h-12 rounded-full bg-accent px-4 font-semibold text-on-accent">{t("enable")}</button>
      </form>
      {lock?.pin && !lock.cred && <button type="button" onClick={addBio} className="min-h-11 rounded-full border border-border px-4 font-semibold">{t("biometricOn")}</button>}
      {lock && <button type="button" onClick={() => { writeLock(null); setLock(null); }} className="min-h-11 rounded-full border border-border px-4 font-semibold text-over-text">{t("disable")}</button>}
      {msg && <p role="alert" className="text-over-text">{msg}</p>}
    </div>
  );
}
