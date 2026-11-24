import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { dupKey, parseBankCsv, parseBankDate, parseSignedAmount } from "@/lib/bank-csv";
import { detectSeparator } from "@/lib/csv";

const fx = (n: string) => fs.readFileSync(new URL(`../fixtures/${n}.csv`, import.meta.url), "utf8");

describe("importes y fechas de extracto", () => {
  it("importe con signo", () => {
    expect(parseSignedAmount("-12,50")).toBe(-1250);
    expect(parseSignedAmount("12,50-")).toBe(-1250);
    expect(parseSignedAmount("(1.234,56)")).toBe(-123456);
    expect(parseSignedAmount("−4.50")).toBe(-450);
    expect(parseSignedAmount("1.800,00")).toBe(180000);
    expect(parseSignedAmount("abc")).toBeNull();
  });
  it("fechas con hora, cortas y largas", () => {
    expect(parseBankDate("2026-11-10 12:30:00")).toBe("2026-11-10");
    expect(parseBankDate("10/11/26")).toBe("2026-11-10");
    expect(parseBankDate("10-11-2026")).toBe("2026-11-10");
    expect(parseBankDate("31/02/2026")).toBeNull();
  });
  it("detecta el separador ignorando líneas de cabecera", () => {
    expect(detectSeparator("Cuenta: x\nA;B;C\n1;2;3")).toBe(";");
    expect(detectSeparator("a,b,c\n1,2,3")).toBe(",");
  });
});

describe("formatos de banco", () => {
  it("Santander: salta la cabecera de cuenta, coma decimal, ignora ingresos", () => {
    const r = parseBankCsv(fx("santander"));
    expect(r.format).toBe("santander");
    expect(r.rows.map((x) => [x.date, x.amountCents])).toEqual([["2026-11-10", 4530], ["2026-11-12", 1399], ["2026-11-12", 1399], ["2026-11-15", 250]]);
    expect(r.skipped).toBe(1);
    expect(r.errors).toEqual([]);
  });
  it("BBVA", () => {
    const r = parseBankCsv(fx("bbva"));
    expect(r.format).toBe("bbva");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ description: "COMPRA CARREFOUR", amountCents: 6215, date: "2026-11-10" });
  });
  it("CaixaBank", () => {
    const r = parseBankCsv(fx("caixabank"));
    expect(r.format).toBe("caixabank");
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(1);
  });
  it("ING", () => {
    const r = parseBankCsv(fx("ing"));
    expect(r.format).toBe("ing");
    expect(r.rows.map((x) => x.amountCents)).toEqual([1840, 1600]);
    expect(r.rows[0]!.description).toBe("Compra Dia");
  });
  it("Revolut: fecha con hora, solo completados y en la moneda de la burbuja", () => {
    const r = parseBankCsv(fx("revolut"), { currency: "EUR" });
    expect(r.format).toBe("revolut");
    expect(r.rows.map((x) => [x.date, x.amountCents])).toEqual([["2026-11-10", 450]]);
    expect(r.errors.map((e) => e.message)).toEqual(["Moneda distinta de la burbuja", "Movimiento no completado"]);
    expect(r.skipped).toBe(1);
  });
  it("N26 con comillas y punto decimal", () => {
    const r = parseBankCsv(fx("n26"));
    expect(r.format).toBe("n26");
    expect(r.rows).toEqual([{ line: 2, date: "2026-11-10", description: "Panadería Ficticia", amountCents: 320 }]);
  });
  it("formato desconocido pide mapear columnas y luego funciona", () => {
    const first = parseBankCsv(fx("generico"));
    expect(first.needsMapping?.headers).toEqual(["dia", "detalle", "gasto"]);
    const r = parseBankCsv(fx("generico"), { mapping: { headerRow: 0, date: 0, description: 1, amount: 2 } });
    expect(r.rows.map((x) => [x.date, x.description, x.amountCents])).toEqual([["2026-11-10", "Cafe", 320], ["2026-11-11", "Taxi", 1200]]);
  });
  it("el formato propio de Fifti (positivos = gasto) sigue funcionando", () => {
    const r = parseBankCsv("fecha,concepto,importe,categoria\n2026-11-10,Café,2.50,Restaurantes\n");
    expect(r.format).toBe("fifti");
    expect(r.rows[0]).toMatchObject({ amountCents: 250, category: "Restaurantes" });
  });
  it("sin importes negativos, los positivos se toman como gasto", () => {
    expect(parseBankCsv("fecha;concepto;importe\n10/11/2026;Pan;1,20\n").rows).toHaveLength(1);
  });
  it("límites: archivo grande y demasiadas filas", () => {
    expect(parseBankCsv("x".repeat(1_000_001)).fatal).toMatch(/grande/);
    const many = "fecha;concepto;importe\n" + Array.from({ length: 501 }, () => "10/11/2026;a;-1,00").join("\n");
    expect(parseBankCsv(many).fatal).toMatch(/Demasiadas/);
  });
  it("neutraliza fórmulas en el concepto", () => {
    expect(parseBankCsv("fecha;concepto;importe\n10/11/2026;'=SUMA(1);-1,00\n").rows[0]!.description).toBe("=SUMA(1)");
  });
  it("clave de duplicado: fecha + importe + concepto normalizado", () => {
    expect(dupKey("2026-11-10", 450, "  Pastelería   FICTICIA ")).toBe(dupKey("2026-11-10", 450, "pasteleria ficticia"));
    expect(dupKey("2026-11-10", 450, "a")).not.toBe(dupKey("2026-11-11", 450, "a"));
  });
});
