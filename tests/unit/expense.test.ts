import { describe, expect, it } from "vitest";
import { buildPayers, buildSplits, toBase, yourShare } from "@/lib/money";

const P = (id: string, bp: number | null = null) => ({ memberId: id, defaultBp: bp });
const sum = (l: { amountCents: number }[]) => l.reduce((a, b) => a + b.amountCents, 0);

describe("buildSplits", () => {
  it("equal reparte sin perder céntimos y los bp suman 10000", () => {
    const s = buildSplits(1000, "equal", [P("a"), P("b"), P("c")]);
    expect(s.map((x) => x.amountCents)).toEqual([334, 333, 333]);
    expect(s.reduce((a, b) => a + b.shareBp, 0)).toBe(10000);
  });
  it("default usa el % del espacio", () => {
    const s = buildSplits(1000, "default", [P("a", 7000), P("b", 3000)]);
    expect(s.map((x) => x.amountCents)).toEqual([700, 300]);
  });
  it("default renormaliza si se excluye a alguien", () => {
    const s = buildSplits(1000, "default", [P("a", 5000), P("c", 2500)]);
    expect(sum(s)).toBe(1000);
    expect(s[0]!.amountCents).toBe(667);
  });
  it("default sin % cae a partes iguales", () => {
    expect(buildSplits(100, "default", [P("a"), P("b")]).map((x) => x.amountCents)).toEqual([50, 50]);
  });
  it("custom por porcentaje exige 100 %", () => {
    const ok = buildSplits(999, "custom", [P("a"), P("b")], { kind: "percent", values: { a: 6000, b: 4000 } });
    expect(sum(ok)).toBe(999);
    expect(() => buildSplits(999, "custom", [P("a"), P("b")], { kind: "percent", values: { a: 6000, b: 3000 } })).toThrow();
  });
  it("custom por importe exige sumar el total", () => {
    const ok = buildSplits(1000, "custom", [P("a"), P("b")], { kind: "amount", values: { a: 250, b: 750 } });
    expect(ok.map((x) => x.shareBp)).toEqual([2500, 7500]);
    expect(() => buildSplits(1000, "custom", [P("a"), P("b")], { kind: "amount", values: { a: 250, b: 700 } })).toThrow();
  });
  it("rechaza participantes repetidos o vacíos", () => {
    expect(() => buildSplits(100, "equal", [])).toThrow();
    expect(() => buildSplits(100, "equal", [P("a"), P("a")])).toThrow();
  });
  it("propiedad: la suma siempre es el total", () => {
    for (let i = 0; i < 300; i++) {
      const total = 1 + Math.floor(Math.random() * 500000);
      const n = 1 + Math.floor(Math.random() * 8);
      const ps = Array.from({ length: n }, (_, k) => P(`m${k}`, Math.floor(Math.random() * 4000)));
      expect(sum(buildSplits(total, "default", ps))).toBe(total);
    }
  });
});

describe("buildPayers y tu parte", () => {
  it("un pagador paga todo", () => {
    expect(buildPayers(500, [{ memberId: "a" }])).toEqual([{ memberId: "a", amountCents: 500 }]);
  });
  it("varios pagadores deben sumar el total", () => {
    expect(sum(buildPayers(500, [{ memberId: "a", amountCents: 200 }, { memberId: "b", amountCents: 300 }]))).toBe(500);
    expect(() => buildPayers(500, [{ memberId: "a", amountCents: 200 }, { memberId: "b", amountCents: 200 }])).toThrow();
    expect(() => buildPayers(500, [{ memberId: "a", amountCents: 500 }, { memberId: "a", amountCents: 0 }])).toThrow();
  });
  it("tu parte", () => {
    const s = buildSplits(1000, "equal", [P("a"), P("b"), P("c")]);
    expect(yourShare(s, "a")).toBe(334);
    expect(yourShare(s, "zzz")).toBe(0);
  });
  it("conversión a moneda base", () => {
    expect(toBase(1000, 1.0825)).toBe(1083);
    expect(toBase(1000, 1)).toBe(1000);
  });
});
