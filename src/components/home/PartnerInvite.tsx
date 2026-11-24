"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "@/components/ui/CopyButton";
import { QrCode } from "@/components/ui/QrCode";
import { useTx } from "@/i18n/tx-client";
import { startPartnerInvite } from "@/server/actions/spaces";

const DISMISS = "fifti:partnerCard";

/** Tarjeta "¿Compartes gastos con tu pareja?": crea el hogar con un toque (o usa el que ya hay) y muestra QR, WhatsApp y copiar enlace. */
export function PartnerInvite({ spaceId, dismissible = true }: { spaceId?: string; dismissible?: boolean }) {
  const x = useTx();
  const router = useRouter();
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; spaceId: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { try { setHidden(dismissible && localStorage.getItem(DISMISS) === "1"); } catch { setHidden(false); } }, 0);
    return () => clearTimeout(t);
  }, [dismissible]);
  if (hidden) return null;

  const start = async () => {
    setBusy(true); setError(null);
    const r = await startPartnerInvite(spaceId ? { spaceId } : {}).catch(() => null);
    setBusy(false);
    if (!r) return setError(x("No se ha podido completar."));
    if (!r.ok) return setError(r.error);
    setLink({ url: r.link, spaceId: r.spaceId }); // no se refresca aquí: al existir ya el hogar, la tarjeta desaparecería con el enlace dentro
  };

  return (
    <section aria-labelledby="partner-title" className="rounded-card border border-border bg-surface p-5">
      <h2 id="partner-title" className="text-lg font-bold">{x("¿Compartes gastos con tu pareja?")}</h2>
      {!link ? (
        <>
          <p className="mt-1 text-sm text-ink-2">{x("Crea vuestro hogar con un toque y mándale la invitación. Cada uno ve el reparto y quién debe a quién.")}</p>
          {error && <p role="alert" className="mt-2 text-sm text-over-text">{error}</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={start} disabled={busy} className="min-h-12 rounded-full bg-accent px-6 font-semibold text-on-accent disabled:opacity-60">{busy ? x("Un momento…") : spaceId ? x("Invitar a mi pareja") : x("Crear hogar e invitar")}</button>
            {dismissible && <button onClick={() => { try { localStorage.setItem(DISMISS, "1"); } catch { /* sin almacenamiento */ } setHidden(true); }} className="min-h-12 px-4 text-sm text-ink-2">{x("Ahora no")}</button>}
          </div>
        </>
      ) : (
        <div className="mt-2 flex flex-col gap-3 text-sm">
          <p className="text-ink-3">{x("Cópialo ahora: no se vuelve a mostrar.")}</p>
          <input readOnly value={link.url} aria-label={x("Enlace")} className="w-full rounded-card border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-ink" />
          <div className="flex flex-wrap items-center gap-3">
            <QrCode text={link.url} size={160} />
            <div className="flex flex-col gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(`${x("Únete a nuestro hogar en Fifti:")} ${link.url}`)}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-full border border-border px-4 font-medium">{x("Enviar por WhatsApp")}</a>
              <CopyButton text={link.url} shareTitle="Fifti" />
            </div>
          </div>
          <p className="text-xs text-ink-3">{x("Caduca en 7 días y sirve para una persona.")}</p>
          <button type="button" onClick={() => router.refresh()} className="min-h-12 self-start rounded-full bg-accent px-6 font-semibold text-on-accent">{x("Hecho")}</button>
        </div>
      )}
    </section>
  );
}
