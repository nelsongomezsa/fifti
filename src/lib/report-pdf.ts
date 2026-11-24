import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { LOGO_DOTS, LOGO_PATH } from "@/components/brand/logo-data";

/** Informe mensual en PDF con el diseño de Fifti (claro, imprimible). Solo recibe datos ya calculados; no toca la base de datos. */
export type ReportData = {
  title: string; bubble: string; monthLabel: string; generated: string;
  labels: { income: string; spent: string; leftover: string; savingsRate: string; funds: string; planned: string; real: string; topCategories: string; balance: string; balanceNote: string; noData: string; pays: string; allSettled: string; footer: string };
  money: (c: number) => string;
  income: number; spent: number; leftover: number; savingsBp: number;
  funds: { name: string; color: string; planned: number; spent: number; usedBp: number }[];
  categories: { name: string; cents: number }[];
  balance: { members: { name: string; cents: number }[]; transfers: { from: string; to: string; cents: number }[] } | null;
};

const INK = rgb(0.043, 0.051, 0.063), SUB = rgb(0.357, 0.392, 0.439), LINE = rgb(0.875, 0.886, 0.847), TRACK = rgb(0.89, 0.9, 0.86);
const GREEN = rgb(0.239, 0.478, 0.071), OVER = rgb(0.851, 0.212, 0.212), WARN = rgb(0.659, 0.455, 0);

/** Helvetica solo codifica WinAnsi: se normalizan espacios finos y flechas y se descarta lo demás. */
export function pdfSafe(s: string): string {
  return s.replace(/[   ]/g, " ").replace(/[→➜]/g, "->").replace(/[−]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e¡-ÿ€–—•…]/g, "?");
}
const hex = (h: string) => { const m = /^#([0-9a-f]{6})$/i.exec(h); return m ? rgb(parseInt(m[1]!.slice(0, 2), 16) / 255, parseInt(m[1]!.slice(2, 4), 16) / 255, parseInt(m[1]!.slice(4), 16) / 255) : SUB; };

export async function buildReportPdf(d: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${d.title} ${d.monthLabel}`)); doc.setCreator("Fifti"); doc.setProducer("Fifti");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), mono = await doc.embedFont(StandardFonts.Courier);
  let page = doc.addPage([595.28, 841.89]);
  const W = 595.28, M = 44, R = W - M;
  let y = 841.89 - 52;

  const text = (p: PDFPage, s: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) => p.drawText(pdfSafe(s), { x, y: yy, size, font: f, color });
  const right = (p: PDFPage, s: string, xr: number, yy: number, size: number, f: PDFFont = mono, color = INK) => { const t = pdfSafe(s); p.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color }); };
  const ensure = (need: number) => { if (y - need < 60) { page = doc.addPage([595.28, 841.89]); y = 841.89 - 52; } };
  const h2 = (s: string) => { ensure(40); y -= 14; text(page, s, M, y, 12, bold); y -= 8; page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 0.6, color: LINE }); y -= 6; };

  // Cabecera: logo dibujado con los mismos trazados que la app (puntos en verde oscuro, como en modo claro)
  const scale = 0.34;
  page.drawSvgPath(LOGO_PATH, { x: M, y: y - 4, scale, color: INK, borderWidth: 0 });
  for (const dot of LOGO_DOTS) {
    page.drawSvgPath(`M ${dot.cx - dot.r} ${dot.cy} a ${dot.r} ${dot.r} 0 1 0 ${dot.r * 2} 0 a ${dot.r} ${dot.r} 0 1 0 ${-dot.r * 2} 0 Z`, { x: M, y: y - 4, scale, ...(dot.filled ? { color: GREEN, borderWidth: 0 } : { borderColor: GREEN, borderWidth: 0.9, color: undefined }) });
  }
  right(page, d.generated, R, y + 2, 8, font, SUB);
  y -= 40;
  text(page, d.title, M, y, 20, bold); y -= 18;
  text(page, `${d.bubble} · ${d.monthLabel}`, M, y, 11, font, SUB); y -= 18;

  // Totales
  const cell = (label: string, value: string, x: number, color = INK) => { text(page, label, x, y, 8.5, font, SUB); text(page, value, x, y - 17, 14, mono, color); };
  page.drawRectangle({ x: M, y: y - 34, width: R - M, height: 46, borderColor: LINE, borderWidth: 0.8, color: rgb(0.965, 0.969, 0.949) });
  const colW = (R - M - 16) / 4;
  cell(d.labels.income, d.money(d.income), M + 10);
  cell(d.labels.spent, d.money(d.spent), M + 10 + colW);
  cell(d.labels.leftover, d.money(d.leftover), M + 10 + colW * 2, d.leftover < 0 ? OVER : INK);
  cell(d.labels.savingsRate, `${Math.round(d.savingsBp / 100)} %`, M + 10 + colW * 3);
  y -= 52;

  // Fondos: previsto frente a real
  h2(d.labels.funds);
  if (d.funds.length === 0) { text(page, d.labels.noData, M, y - 8, 10, font, SUB); y -= 22; }
  text(page, d.labels.planned, 300, y - 6, 8, font, SUB); text(page, d.labels.real, 390, y - 6, 8, font, SUB); y -= 10;
  for (const f of d.funds) {
    ensure(34); y -= 16;
    page.drawCircle({ x: M + 4, y: y + 3, size: 3.2, color: hex(f.color) });
    text(page, f.name, M + 14, y, 10);
    right(page, d.money(f.planned), 360, y, 9); right(page, d.money(f.spent), 450, y, 9, mono, f.usedBp >= 10000 ? OVER : INK);
    right(page, `${Math.round(f.usedBp / 100)} %`, R, y, 9, mono, f.usedBp >= 10000 ? OVER : f.usedBp >= 8000 ? WARN : SUB);
    y -= 7; page.drawRectangle({ x: M + 14, y, width: R - M - 14, height: 3.5, color: TRACK });
    page.drawRectangle({ x: M + 14, y, width: Math.max(0, Math.min(1, f.usedBp / 10000)) * (R - M - 14), height: 3.5, color: f.usedBp >= 10000 ? OVER : f.usedBp >= 8000 ? WARN : hex(f.color) });
  }

  // Mayores categorías
  h2(d.labels.topCategories);
  if (d.categories.length === 0) { text(page, d.labels.noData, M, y - 8, 10, font, SUB); y -= 22; }
  for (const c of d.categories) { ensure(20); y -= 15; text(page, c.name, M, y, 10); right(page, d.money(c.cents), R, y, 10); }

  // Balance del hogar o grupo
  if (d.balance) {
    h2(d.labels.balance);
    text(page, d.labels.balanceNote, M, y - 6, 8, font, SUB); y -= 12;
    for (const m of d.balance.members) { ensure(20); y -= 15; text(page, m.name, M, y, 10); right(page, `${m.cents > 0 ? "+" : ""}${d.money(m.cents)}`, R, y, 10, mono, m.cents < 0 ? OVER : INK); }
    y -= 4;
    if (d.balance.transfers.length === 0) { ensure(20); y -= 15; text(page, d.labels.allSettled, M, y, 10, font, SUB); }
    for (const t of d.balance.transfers) { ensure(20); y -= 15; text(page, `${t.from} ${d.labels.pays} ${t.to}`, M, y, 10); right(page, d.money(t.cents), R, y, 10); }
  }

  for (const p of doc.getPages()) text(p, d.labels.footer, M, 28, 7.5, font, SUB);
  return doc.save();
}
