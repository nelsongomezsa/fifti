import { describe, expect, it } from "vitest";
import { parsePhrase, suggestCategory, type NlSpace } from "@/lib/nl/parse";
import { matchRule } from "@/lib/rules/match";

const cats = [{ id: "c-super", name: "Supermercado" }, { id: "c-rest", name: "Restaurantes" }, { id: "c-sub", name: "Suscripciones" }, { id: "c-taxi", name: "Transporte" }];
const personal: NlSpace = { id: "p", name: "Personal", kind: "personal", meId: "ana-p", members: [{ id: "ana-p", name: "Ana" }], categories: cats };
const casa: NlSpace = { id: "h", name: "Casa de Ana y Leo", kind: "household", meId: "ana-h", members: [{ id: "ana-h", name: "Ana" }, { id: "leo-h", name: "Leo" }], categories: cats };
const lisboa: NlSpace = { id: "l", name: "Viaje Lisboa", kind: "group", meId: "ana-l", members: [{ id: "ana-l", name: "Ana" }, { id: "leo-l", name: "Leo" }, { id: "marta-l", name: "Marta" }], categories: cats };
const all = [personal, casa, lisboa];

describe("parsePhrase", () => {
  it("importe con coma y categoría por palabra clave", () => {
    const r = parsePhrase("12,50 súper", all, "p");
    expect(r.amountCents).toBe(1250);
    expect(r.categoryId).toBe("c-super");
    expect(r.description).toBe("Súper");
  });
  it("importe con punto y símbolo €", () => {
    expect(parsePhrase("cena 23.5€", all, "p").amountCents).toBe(2350);
    expect(parsePhrase("1.234,56 alquiler", all, "p").amountCents).toBe(123456);
  });
  it("persona y a medias: elige el hogar donde está Leo y reparte entre los dos", () => {
    const r = parsePhrase("23 cena con Leo a medias", all, "p");
    expect(r.amountCents).toBe(2300);
    expect(r.spaceId).toBe("h");
    expect(r.splitMode).toBe("equal");
    expect(r.participantIds).toEqual(["ana-h", "leo-h"]);
    expect(r.categoryId).toBe("c-rest");
  });
  it("burbuja por nombre del grupo y 'entre N' con todos", () => {
    const r = parsePhrase("60 taxi viaje lisboa entre 3", all, "p");
    expect(r.spaceId).toBe("l");
    expect(r.participantIds).toHaveLength(3);
    expect(r.categoryId).toBe("c-taxi");
    expect(r.amountCents).toBe(6000);
  });
  it("'entre 3' no se toma como importe", () => {
    expect(parsePhrase("cena en Viaje Lisboa entre 3 45", all, "p").amountCents).toBe(4500);
  });
  it("lo pago yo deja solo a quien paga", () => {
    const r = parsePhrase("8 café lo pago yo", all, "h");
    expect(r.participantIds).toEqual(["ana-h"]);
  });
  it("recurrente", () => {
    const r = parsePhrase("netflix 13,99 cada mes", all, "p");
    expect(r.recurring).toBe(true);
    expect(r.amountCents).toBe(1399);
    expect(r.categoryId).toBe("c-sub");
    expect(r.description).toBe("Netflix");
  });
  it("sin importe devuelve solo concepto", () => {
    const r = parsePhrase("   ", all, "p");
    expect(r).toEqual({});
    expect(parsePhrase("regalo para Marta", all, "p").amountCents).toBeUndefined();
  });
  it("personal explícito", () => {
    expect(parsePhrase("5 café personal", all, "h").spaceId).toBe("p");
  });
  it("una regla de la burbuja manda sobre las palabras clave", () => {
    const conRegla: NlSpace = { ...personal, rules: [{ id: "r", matchText: "mercadona", matchType: "contains", categoryId: "c-taxi", priority: 10 }] };
    expect(parsePhrase("12 mercadona", [conRegla], "p").categoryId).toBe("c-taxi");
  });
  it("gasto fijo: «Spotify» sugiere Suscripciones y una regla del usuario manda sobre el diccionario", () => {
    const cats2 = [...cats, { id: "c-ocio", name: "Ocio" }];
    expect(suggestCategory("Spotify", cats2)).toBe("c-sub");
    expect(suggestCategory("Netflix", cats2)).toBe("c-sub");
    const rules = [{ id: "r", matchText: "spotify", matchType: "contains" as const, categoryId: "c-ocio", priority: 10 }];
    expect(matchRule(rules, "Spotify familiar")?.categoryId).toBe("c-ocio");
  });
});
