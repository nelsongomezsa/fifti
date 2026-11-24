import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildReportPdf, pdfSafe, type ReportData } from "@/lib/report-pdf";

const data = (over: Partial<ReportData> = {}): ReportData => ({
  title: "Informe mensual", bubble: "Casa de Ana y Leo", monthLabel: "octubre de 2026", generated: "24 nov 2026",
  labels: { income: "Ingresos", spent: "Gasto", leftover: "Te sobró", savingsRate: "Tasa de ahorro", funds: "Fondos", planned: "Previsto", real: "Real", topCategories: "Mayores categorías", balance: "Balance", balanceNote: "Saldo actual.", noData: "Sin datos.", pays: "paga a", allSettled: "Todo saldado.", footer: "Generado con Fifti" },
  money: (c) => `${(c / 100).toFixed(2).replace(".", ",")} €`,
  income: 380000, spent: 235600, leftover: 144400, savingsBp: 3800,
  funds: [{ name: "Gastos fijos", color: "#9AA3AF", planned: 150000, spent: 148200, usedBp: 9880 }, { name: "Ocio", color: "#FF9F43", planned: 40000, spent: 52000, usedBp: 13000 }],
  categories: [{ name: "Alquiler", cents: 90000 }, { name: "Supermercado", cents: 38000 }],
  balance: { members: [{ name: "Ana", cents: 12000 }, { name: "Leo", cents: -12000 }], transfers: [{ from: "Leo", to: "Ana", cents: 12000 }] },
  ...over,
});

describe("informe PDF", () => {
  it("genera un PDF válido con el balance", async () => {
    const bytes = await buildReportPdf(data());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2000);
  });
  it("funciona sin fondos, sin categorías y sin balance (burbuja personal)", async () => {
    const bytes = await buildReportPdf(data({ funds: [], categories: [], balance: null }));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
  it("no revienta con caracteres que Helvetica no codifica (nombres con emojis, flechas, espacios finos)", async () => {
    expect(pdfSafe("Viaje ✈️ Lisboa → 12 €")).toBe("Viaje ?? Lisboa -> 12 €");
    await expect(buildReportPdf(data({ bubble: "Viaje ✈️ 日本 Lisboa" }))).resolves.toBeInstanceOf(Uint8Array);
  });
  it("pagina cuando hay muchas filas", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ name: `Categoría ${i}`, cents: 1000 + i }));
    const bytes = await buildReportPdf(data({ categories: many }));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
