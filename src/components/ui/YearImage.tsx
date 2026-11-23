"use client";


import { useTx } from "@/i18n/tx-client";
import { useRef } from "react";

/** Imagen "Tu año en Fifti" para compartir. Solo contiene nombres de categoría, meses y recuentos: sin importes. */
export function YearImage({ year, cards }: { year: number; cards: { title: string; value: string }[] }) {
  const x = useTx();
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = () => {
    const c = ref.current!, W = 1080, H = 400 + cards.length * 230;
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0B0D10"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#C6F432"; g.beginPath(); g.arc(120, 130, 20, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#C6F432"; g.lineWidth = 8; g.beginPath(); g.arc(182, 130, 17, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#F2F4F7"; g.font = "700 84px system-ui, sans-serif"; g.fillText(`${x("Tu año")} ${year}`, 96, 290);
    cards.forEach((k, i) => {
      const y = 360 + i * 230;
      g.fillStyle = "#15181D"; g.beginPath(); g.roundRect(72, y, W - 144, 200, 32); g.fill();
      g.fillStyle = "#9AA3AF"; g.font = "400 34px system-ui, sans-serif"; g.fillText(k.title, 112, y + 70);
      g.fillStyle = "#F2F4F7"; g.font = "700 56px system-ui, sans-serif"; g.fillText(k.value.slice(0, 22), 112, y + 150);
    });
    return c;
  };
  const toBlob = () => new Promise<Blob | null>((r) => draw().toBlob(r, "image/png"));
  const download = async () => {
    const b = await toBlob();
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = `tu-ano-${year}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const share = async () => {
    const b = await toBlob();
    if (!b) return;
    const f = new File([b], `tu-ano-${year}.png`, { type: "image/png" });
    try { if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: `${x("Tu año")} ${year} Fifti` }); else await download(); } catch { /* cancelado */ }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <canvas ref={ref} className="hidden" aria-hidden />
      <button type="button" onClick={share} className="min-h-11 rounded-full bg-accent px-5 font-semibold text-on-accent">{x("Compartir imagen")}</button>
      <button type="button" onClick={download} className="min-h-11 rounded-full border border-border px-5 font-semibold">{x("Descargar")}</button>
    </div>
  );
}
