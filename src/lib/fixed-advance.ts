import type { PushPayload } from "@/i18n/push-content";
import type { Translate } from "@/i18n/translate";

/** Antelación del aviso de gasto fijo: 1, 3 o 7 días. */
export const ADVANCE_OPTIONS = [1, 3, 7] as const;
export type Advance = (typeof ADVANCE_OPTIONS)[number];
export const toAdvance = (v: unknown): Advance => (ADVANCE_OPTIONS as readonly unknown[]).includes(v) ? (v as Advance) : 1;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

/** A quién avisar hoy de un cobro que vence en `daysLeft` días: a quien eligió justo esa antelación. */
export const usersForLead = (prefs: { userId: string; advance: number | null }[], userIds: string[], daysLeft: number): string[] =>
  userIds.filter((u) => toAdvance(prefs.find((p) => p.userId === u)?.advance) === daysLeft);

/** Texto del aviso: dice el nombre del gasto y cuándo vence, sin importe (nada de dinero en la pantalla de bloqueo). */
export const fixedExpensePayload = (name: string, daysLeft: number): ((t: Translate) => PushPayload) => (t) => ({
  title: "Fifti",
  body: `${t("Vence")} «${name.slice(0, 60)}» ${daysLeft <= 1 ? t("mañana") : daysLeft === 3 ? t("en 3 días") : t("en 7 días")}.`,
  url: "/calendario",
});
