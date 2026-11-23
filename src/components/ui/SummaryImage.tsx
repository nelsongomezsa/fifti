"use client";


import { useTx } from "@/i18n/tx-client";
import { useRef } from "react";

export type SummaryLine = { text: string; amount: string };

/** Imagen del resumen para compartir en el grupo. Solo nombres e importes finales; sin conceptos de gastos. */
export function SummaryImage({ title, total, lines }: { title: string; total: string; lines: SummaryLine[] }) {
  const x = useTx();
  const canvas = useRef<HTMLCanvasElement>(null);

  const draw = () => {
    const c = canvas.current!;
    const W = 1080, H = Math.max(900, 460 + lines.length * 96 + 140);
    c.width = W; c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0B0D10"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#15181D"; g.beginPath(); g.roundRect(48, 48, W - 96, H - 96, 40); g.fill();
    g.fillStyle = "#C6F432"; g.beginPath(); g.arc(120, 124, 18, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#C6F432"; g.lineWidth = 7; g.beginPath(); g.arc(176, 124, 15, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#F2F4F7"; g.font = "700 64px system-ui, sans-serif"; g.fillText(title.slice(0, 28), 96, 250);
    g.fillStyle = "#9AA3AF"; g.font = "400 34px system-ui, sans-serif"; g.fillText(x("Total del plan"), 96, 330);
    g.fillStyle = "#C6F432"; g.font = "600 92px ui-monospace, monospace"; g.fillText(total, 96, 430);
    let y = 540;
    if (lines.length === 0) { g.fillStyle = "#D0D5DD"; g.font = "500 44px system-ui, sans-serif"; g.fillText(x("Todo saldado"), 96, y); }
    for (const l of lines) {
      g.fillStyle = "#D0D5DD"; g.font = "500 42px system-ui, sans-serif"; g.fillText(l.text.slice(0, 26), 96, y);
      g.fillStyle = "#F2F4F7"; g.font = "600 44px ui-monospace, monospace"; g.textAlign = "right"; g.fillText(l.amount, W - 96, y); g.textAlign = "left";
      y += 96;
    }
    g.fillStyle = "#9AA3AF"; g.font = "400 30px system-ui, sans-serif"; g.fillText(x("Cuentas claras con Fifti"), 96, H - 96);
    return c;
  };

  const toBlob = () => new Promise<Blob | null>((r) => draw().toBlob(r, "image/png"));
  const download = async () => {
    const b = await toBlob();
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = "resumen-fifti.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const share = async () => {
    const b = await toBlob();
    if (!b) return;
    const file = new File([b], "resumen-fifti.png", { type: "image/png" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else await download();
    } catch { /* cancelado */ }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <canvas ref={canvas} className="hidden" aria-hidden />
      <button type="button" onClick={share} className="min-h-11 rounded-full border border-border px-5 font-semibold">{x("Compartir imagen")}</button>
      <button type="button" onClick={download} className="min-h-11 rounded-full border border-border px-5 font-semibold">{x("Descargar imagen")}</button>
    </div>
  );
}
