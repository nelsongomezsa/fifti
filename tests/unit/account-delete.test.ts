import { describe, expect, it } from "vitest";
import { clearedBody, deletedSpaceNotices, deleteImpact,type OtherAccount, type TransferRow } from "@/lib/account-delete";
import { localizePayload } from "@/i18n/push-content";

const me = "ana", gone = "A";
const t = (from: string, to: string, amountCents: number, extra: Partial<TransferRow> = {}): TransferRow => ({ userId: me, from, to, amountCents, toAmountCents: null, date: "2026-11-10", ...extra });
const accounts: OtherAccount[] = [
  { id: "B", name: "Ahorro", currency: "EUR", openingDate: "2026-11-01" },
  { id: "C", name: "Australia", currency: "AUD", openingDate: "2026-11-01" },
];

describe("saldos que cambian al borrar una cuenta", () => {
  it("quien recibió pierde lo recibido y quien envió lo recupera, cada uno en su moneda", () => {
    const r = deleteImpact(gone, me, [t(gone, "B", 5000), t("B", gone, 2000), t(gone, "C", 1000, { toAmountCents: 1600 })], accounts);
    expect(r.changes).toEqual([{ name: "Ahorro", currency: "EUR", deltaCents: -3000 }, { name: "Australia", currency: "AUD", deltaCents: -1600 }]);
    expect(r).toMatchObject({ hidden: false, othersTransfers: false });
  });
  it("no cuenta lo anterior al saldo inicial ni muestra cambios que se anulan", () => {
    expect(deleteImpact(gone, me, [t(gone, "B", 5000, { date: "2026-10-01" })], accounts).changes).toEqual([]);
    expect(deleteImpact(gone, me, [t(gone, "B", 500), t("B", gone, 500)], accounts).changes).toEqual([]);
  });
  it("las cuentas que no se ven se avisan sin nombre ni importe, y los traspasos ajenos también", () => {
    const r = deleteImpact(gone, me, [t("Z", gone, 9000, { userId: "leo" })], accounts);
    expect(r).toEqual({ changes: [], hidden: true, othersTransfers: true });
  });
  it("al borrar un espacio, quien tenía cuentas recibe que han pasado a Personal y el resto no", () => {
    const [moved, rest] = deletedSpaceNotices(["leo", "eva"], ["leo"]);
    expect(moved).toMatchObject({ users: ["leo"], url: "/cuentas" });
    expect(rest).toMatchObject({ users: ["eva"], body: "Se ha borrado este espacio." });
    for (const [locale, word] of [["es", /Personal/], ["en", /Personal/]] as const) {
      expect(localizePayload((tr) => ({ title: "Casa", body: tr(moved!.body), url: moved!.url }), locale).body).toMatch(word);
    }
    expect(localizePayload((tr) => ({ title: "Casa", body: tr(moved!.body), url: "/cuentas" }), "en").body).not.toBe(moved!.body);
    expect(deletedSpaceNotices([], [])).toEqual([]);
  });
  it("el aviso a los demás dice si se borraron cuentas, sin importes, en su idioma", () => {
    for (const locale of ["es", "en"]) {
      const body = (n: number) => localizePayload((tr) => ({ title: "Casa", body: tr(clearedBody(n)), url: "/inicio" }), locale).body;
      expect(body(2)).not.toBe(body(0));
      expect(body(2)).toMatch(locale === "es" ? /cuentas/ : /accounts/);
      expect(body(2)).not.toMatch(/\d/);
    }
  });
});
