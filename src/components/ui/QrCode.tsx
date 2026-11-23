"use client";


import { useTx } from "@/i18n/tx-client";
import { useMemo } from "react";
import QRCode from "qrcode";

/** QR dibujado como SVG con rects (sin inyectar HTML). Contraste alto y zona de silencio incluida. */
export function QrCode({ text, size = 176 }: { text: string; size?: number }) {
  const x = useTx();
  const { n, cells } = useMemo(() => {
    const q = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = q.modules.size;
    const cells: [number, number][] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.get(x, y)) cells.push([x, y]);
    return { n, cells };
  }, [text]);
  const pad = 2;
  return (
    <svg role="img" aria-label={x("Código QR del enlace")} viewBox={`0 0 ${n + pad * 2} ${n + pad * 2}`} width={size} height={size} shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x + pad} y={y + pad} width="1" height="1" fill="#0B0D10" />)}
    </svg>
  );
}
