"use client";


import { useTx } from "@/i18n/tx-client";
import { useEffect, useRef } from "react";

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id: string) => void } }
}

/** Widget de Cloudflare Turnstile. Deja el token en un campo oculto `cf-turnstile-response` del formulario. */
export function Turnstile({ siteKey, appearance = "always" }: { siteKey: string; appearance?: "always" | "interaction-only" }) {
  const x = useTx();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let id: string | undefined;
    const mount = () => {
      if (!window.turnstile || !box.current || id) return;
      id = window.turnstile.render(box.current, {
        sitekey: siteKey, theme: "auto", appearance, language: "auto",
        callback: (t: string) => { if (input.current) input.current.value = t; },
        "expired-callback": () => { if (input.current) input.current.value = ""; },
      });
    };
    // El token es de un solo uso: tras enviar el formulario se pide uno nuevo para el siguiente intento
    const form = box.current.closest("form");
    const renew = () => { setTimeout(() => { if (id && window.turnstile) { if (input.current) input.current.value = ""; window.turnstile.reset(id); } }, 2000); };
    form?.addEventListener("submit", renew);
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
    return () => { form?.removeEventListener("submit", renew); if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey, appearance]);

  return (
    <>
      <input ref={input} type="hidden" name="cf-turnstile-response" />
      <div ref={box} aria-label={x("Verificación anti-bots")} />
    </>
  );
}

/** ¿Tiene el formulario ya su token de Turnstile? Sin clave de sitio (desarrollo) no hay widget y no se exige. */
export function captchaReady(form: HTMLFormElement): boolean {
  const field = form.elements.namedItem("cf-turnstile-response");
  return !(field instanceof HTMLInputElement) || field.value.length > 0;
}
