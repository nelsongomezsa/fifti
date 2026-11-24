/** Recordatorio diario: hora y día locales de cada persona según su zona horaria. Funciones puras. */
export function localParts(at: Date, timeZone: string): { hour: number; ymd: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = Number(get("hour"));
    return Number.isInteger(hour) ? { hour, ymd: `${get("year")}-${get("month")}-${get("day")}` } : null;
  } catch { return null; } // zona horaria no válida
}

/** Toca avisar si ahora es su hora y aún no ha apuntado nada hoy (en su día local). */
export function shouldRemind(pref: { reminderHour: number; timezone: string }, now: Date, createdAts: Date[]): { remind: boolean; ymd: string } | null {
  const local = localParts(now, pref.timezone);
  if (!local || local.hour !== pref.reminderHour) return local ? { remind: false, ymd: local.ymd } : null;
  const loggedToday = createdAts.some((d) => localParts(d, pref.timezone)?.ymd === local.ymd);
  return { remind: !loggedToday, ymd: local.ymd };
}
