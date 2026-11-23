import { describe, expect, it } from "vitest";
import es from "../../messages/es.json";
import en from "../../messages/en.json";

const keys = (o: Record<string, unknown>, p = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v !== null ? keys(v as Record<string, unknown>, `${p}${k}.`) : [`${p}${k}`]));

describe("i18n", () => {
  it("es y en tienen exactamente las mismas claves", () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });
  it("los marcadores {x} coinciden entre idiomas", () => {
    const flat = (o: Record<string, unknown>): Record<string, string> => Object.fromEntries(keys(o).map((k) => [k, k.split(".").reduce((a: any, c) => a[c], o) as string]));
    const fe = flat(es), fn = flat(en);
    for (const k of Object.keys(fe)) expect((fe[k]!.match(/\{\w+\}/g) ?? []).sort(), k).toEqual((fn[k]!.match(/\{\w+\}/g) ?? []).sort());
  });
});
