"use client";

import { useEffect, useState } from "react";
import { removePushSubscription, savePushSubscription } from "@/server/actions/push";

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Activa/desactiva las notificaciones push de este dispositivo. En iPhone solo funcionan con la app instalada. */
export function PushSettings({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<"checking" | "unsupported" | "ios-install" | "off" | "on" | "denied">("checking");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (ios && !standalone) return setState("ios-install");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !publicKey) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    }, 0);
    return () => clearTimeout(t);
  }, [publicKey]);

  const enable = async () => {
    setMsg(null);
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const res = await savePushSubscription(sub.toJSON());
    if (!res.ok) { await sub.unsubscribe(); return setMsg(res.error ?? "No se ha podido activar."); }
    setState("on");
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    setState("off");
  };

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 text-sm">
      {state === "ios-install" && <p className="text-ink-2">En iPhone las notificaciones solo funcionan con Fifti instalada: pulsa Compartir y «Añadir a pantalla de inicio» (iOS 16.4 o superior) y ábrela desde el icono.</p>}
      {state === "unsupported" && <p className="text-ink-2">Este navegador no admite notificaciones push.</p>}
      {state === "denied" && <p className="text-ink-2">Has bloqueado las notificaciones. Actívalas en los ajustes del navegador.</p>}
      {state === "off" && <button type="button" onClick={enable} className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent">Activar notificaciones en este dispositivo</button>}
      {state === "on" && <button type="button" onClick={disable} className="min-h-11 rounded-full border border-border px-5 font-semibold">Desactivar en este dispositivo</button>}
      {msg && <p role="alert" className="text-over-text">{msg}</p>}
    </div>
  );
}
