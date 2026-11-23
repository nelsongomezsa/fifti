import { describe, expect, it } from "vitest";
import { escapeFormula, parseAmountLoose, parseCsv, parseDateLoose, previewImport, toCsv, unescapeFormula, CSV_MAX_ROWS } from "@/lib/csv";
import { parseReceiptText } from "@/lib/receipt";
import { detectSubscriptions, normalizeConcept } from "@/lib/detect";
import { projectRecurring } from "@/lib/calendar";
import { sniffImageType } from "@/lib/security/image";

describe("CSV: seguridad", () => {
  it("escapa la inyección de fórmulas en todos los disparadores", () => {
    for (const bad of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tx", "\rx"]) expect(escapeFormula(bad)).toBe(`'${bad}`);
    expect(escapeFormula("Café")).toBe("Café");
    expect(unescapeFormula("'=1+1")).toBe("=1+1");
    expect(unescapeFormula("'normal")).toBe("'normal");
  });
  it("toCsv escapa fórmulas, comillas y comas", () => {
    expect(toCsv([["=HYPERLINK(\"x\")", 'di "hola", ok', 12.5]])).toBe('"\'=HYPERLINK(""x"")","di ""hola"", ok",12.5\r\n');
  });
  it("round-trip: lo exportado se importa igual", () => {
    const csv = toCsv([["fecha", "concepto", "importe"], ["2026-11-10", "=EVIL()", "12,50"]]);
    const r = previewImport(csv);
    expect(r.rows[0]).toMatchObject({ description: "=EVIL()", amountCents: 1250, date: "2026-11-10" });
  });
});

describe("CSV: importación", () => {
  it("parsea comillas, saltos de línea y punto y coma", () => {
    expect(parseCsv('a;b\n"x;y";"z\nw"')).toEqual([["a", "b"], ["x;y", "z\nw"]]);
  });
  it("importes y fechas flexibles", () => {
    expect(parseAmountLoose("1.234,56")).toBe(123456);
    expect(parseAmountLoose("1,234.56")).toBe(123456);
    expect(parseAmountLoose("12,5")).toBe(1250);
    expect(parseAmountLoose("12 €")).toBe(1200);
    expect(parseAmountLoose("-5")).toBeNull();
    expect(parseAmountLoose("0")).toBeNull();
    expect(parseAmountLoose("abc")).toBeNull();
    expect(parseDateLoose("05/11/2026")).toBe("2026-11-05");
    expect(parseDateLoose("31/02/2026")).toBeNull();
    expect(parseDateLoose("2026-13-01")).toBeNull();
  });
  it("valida cada fila y reporta errores sin guardar nada", () => {
    const r = previewImport("fecha,concepto,importe,categoria\n2026-11-01,Café,2.50,Ocio\n2026-11-02,,5\nxx,Pan,1\n2026-11-03,Cena,-4");
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });
  it("límites de tamaño, filas y cabecera", () => {
    expect(previewImport("x".repeat(1_000_001)).errors[0]!.message).toMatch(/grande/);
    const many = "fecha,concepto,importe\n" + Array.from({ length: CSV_MAX_ROWS + 1 }, () => "2026-11-01,a,1").join("\n");
    expect(previewImport(many).errors[0]!.message).toMatch(/Demasiadas/);
    expect(previewImport("a,b\n1,2").errors[0]!.message).toMatch(/columnas/);
  });
  it("descripción demasiado larga se rechaza", () => {
    expect(previewImport(`fecha,concepto,importe\n2026-11-01,${"x".repeat(121)},1`).errors).toHaveLength(1);
  });
});

describe("OCR de tickets", () => {
  it("propone total y fecha", () => {
    const t = "MERCADONA\n12/11/2025\nPan 1,20\nLeche 0,95\nSUBTOTAL 2,15\nIVA 0,21\nTOTAL 23,45\nGracias";
    expect(parseReceiptText(t)).toEqual({ amountCents: 2345, date: "2025-11-12" });
  });
  it("sin la palabra total usa el mayor importe y tolera miles", () => {
    expect(parseReceiptText("Hotel\n1.234,50\n12,00").amountCents).toBe(123450);
  });
  it("sin datos devuelve nulos", () => {
    expect(parseReceiptText("hola mundo")).toEqual({ amountCents: null, date: null });
  });
});

describe("imágenes: tipo real por magic bytes", () => {
  it("reconoce jpeg/png/webp y rechaza el resto", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe("detector de suscripciones", () => {
  const e = (d: string, a: number, desc = "Netflix") => ({ description: desc, amountCents: a, spentAt: d });
  it("normaliza conceptos", () => { expect(normalizeConcept("NETFLIX 11/2026 Ñ")).toBe("netflix n"); });
  it("detecta 3 meses seguidos con importe parecido", () => {
    const r = detectSubscriptions([e("2026-08-05", 1299), e("2026-09-05", 1299), e("2026-10-06", 1299, "NETFLIX"), e("2026-10-20", 500, "Café")]);
    expect(r).toEqual([{ description: "NETFLIX", amountCents: 1299, day: 6, months: 3 }]);
  });
  it("no detecta con meses salteados ni importes muy distintos ni ya conocidos", () => {
    expect(detectSubscriptions([e("2026-07-05", 1299), e("2026-09-05", 1299), e("2026-10-05", 1299)])).toEqual([]);
    expect(detectSubscriptions([e("2026-08-05", 1000), e("2026-09-05", 2000), e("2026-10-05", 1000)])).toEqual([]);
    expect(detectSubscriptions([e("2026-08-05", 1299), e("2026-09-05", 1299), e("2026-10-05", 1299)], ["netflix"])).toEqual([]);
  });
});

describe("calendario de pagos", () => {
  const r = (over = {}) => ({ id: "1", description: "Alquiler", amountCents: 65000, frequency: "monthly" as const, day: 31, nextRun: "2026-11-30", ...over });
  it("mensual: el día se ajusta al último del mes", () => {
    expect(projectRecurring(r(), "2026-11-01")).toEqual(["2026-11-30"]);
    expect(projectRecurring(r(), "2027-02-01")).toEqual(["2027-02-28"]);
    expect(projectRecurring(r(), "2026-10-01")).toEqual([]);
  });
  it("semanal y anual", () => {
    expect(projectRecurring(r({ frequency: "weekly", nextRun: "2026-11-02" }), "2026-11-01")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(projectRecurring(r({ frequency: "yearly", nextRun: "2026-03-15" }), "2026-03-01")).toEqual(["2026-03-15"]);
  });
});
