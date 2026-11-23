/** Propone importe y fecha a partir del texto de un ticket (OCR). Solo sugiere: el usuario confirma. */
export function parseReceiptText(text: string): { amountCents: number | null; date: string | null } {
  const lines = text.split(/\r?\n/);
  const money = /(\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}|\d+[,.]\d{2})(?!\d)/g;
  const toCents = (s: string) => {
    const t = s.replace(/\s/g, "");
    const dec = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
    const n = Number(t.slice(0, dec).replace(/[.,]/g, "") + "." + t.slice(dec + 1));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  let best: number | null = null;
  const totals = lines.filter((l) => /total|importe|a pagar|suma/i.test(l) && !/subtotal|iva|base/i.test(l));
  for (const l of totals) for (const m of l.matchAll(money)) { const c = toCents(m[1]!); if (c && (best === null || c > best)) best = c; }
  if (best === null) for (const l of lines) for (const m of l.matchAll(money)) { const c = toCents(m[1]!); if (c && c < 100_000_00 && (best === null || c > best)) best = c; }

  let date: string | null = null;
  const d = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (d) {
    const y = d[3]!.length === 2 ? `20${d[3]}` : d[3]!;
    const iso = `${y}-${d[2]!.padStart(2, "0")}-${d[1]!.padStart(2, "0")}`;
    if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso) date = iso;
  }
  return { amountCents: best, date };
}
