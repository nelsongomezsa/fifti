"use client";


import { useTx } from "@/i18n/tx-client";
import { useEffect, useRef } from "react";

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void } }
}

/** Widget de Cloudflare Turnstile. Deja el token en un campo oculto `cf-turnstile-response` del formulario. */
export function Turnstile({ siteKey }: { siteKey: string }) {
  const x = useTx();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let id: string | undefined;
    const mount = () => {
      if (!window.turnstile || !box.current || id) return;
      id = window.turnstile.render(box.current, {
        sitekey: siteKey, theme: "auto",
        callback: (t: string) => { if (input.current) input.current.value = t; },
        "expired-callback": () => { if (input.current) input.current.value = ""; },
      });
    };
    if (window.turnstile) mount();
    else {
      let s = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      if (!s) {
        s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true; s.dataset.turnstile = "1";
        document.head.appendChild(s);
      }
      s.addEventListener("load", mount);
    }
    return () => { if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey]);

  return (
    <>
      <input ref={input} type="hidden" name="cf-turnstile-response" />
      <div ref={box} aria-label={x("Verificación anti-bots")} />
    </>
  );
}
