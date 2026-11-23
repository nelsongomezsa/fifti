"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FAIL_KEY, lockoutSeconds, readLock, verifyBiometric, verifyPin } from "@/lib/applock";

const IDLE_MS = 30_000;

/** Pantalla de bloqueo: al abrir la app y al volver tras 30 s en segundo plano. Contenido `inert` mientras está bloqueada. */
export function AppLock({ children }: { children: React.ReactNode }) {
  const t = useTranslations("lock");
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const hiddenAt = useRef<number | null>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t0 = setTimeout(() => { if (readLock()) setLocked(true); }, 0);
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > IDLE_MS && readLock()) setLocked(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t0); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  useEffect(() => {
    const el = content.current;
    if (!el) return;
    if (locked) el.setAttribute("inert", ""); else el.removeAttribute("inert");
  }, [locked]);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(id);
  }, [wait]);

  const unlock = useCallback(() => { setLocked(false); setPin(""); setError(null); try { localStorage.removeItem(FAIL_KEY); } catch { /* sin almacenamiento */ } }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lock = readLock();
    if (!lock?.pin || wait > 0) return;
    if (await verifyPin(pin, lock.pin)) return unlock();
    let fails = 1;
    try { fails = Number(localStorage.getItem(FAIL_KEY) ?? "0") + 1; localStorage.setItem(FAIL_KEY, String(fails)); } catch { /* sin almacenamiento */ }
    setPin(""); setError(t("wrongPin")); setWait(lockoutSeconds(fails));
  };

  const lock = typeof window !== "undefined" ? readLock() : null;
  return (
    <>
      <div ref={content}>{children}</div>
      {locked && (
        <div role="dialog" aria-modal="true" aria-label={t("title")} className="fixed inset-0 z-[70] grid place-items-center bg-bg px-6">
          <form onSubmit={submit} className="flex w-full max-w-xs flex-col items-stretch gap-4 text-center">
            <h2 className="text-xl font-bold">{t("title")}</h2>
            {lock?.pin && (
              <>
                <input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  aria-label={t("enterPin")} placeholder={t("enterPin")} className="min-h-14 rounded-card border border-border bg-surface px-4 text-center font-mono text-2xl tracking-[0.5em] text-ink" />
                <button type="submit" disabled={wait > 0 || pin.length < 4} className="min-h-12 rounded-full bg-lime font-semibold text-on-accent disabled:opacity-50">{t("unlock")}</button>
              </>
            )}
            {lock?.cred && <button type="button" className="min-h-12 rounded-full border border-border font-semibold" onClick={async () => { if (await verifyBiometric(lock.cred!)) unlock(); }}>{t("useBiometric")}</button>}
            {error && <p role="alert" className="text-sm text-over-text">{error}</p>}
            {wait > 0 && <p className="text-sm text-ink-3">{t("wait", { s: wait })}</p>}
          </form>
        </div>
      )}
    </>
  );
}
