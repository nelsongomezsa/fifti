/** Cada mes se guarda como su primer día (YYYY-MM-01, en UTC). */
export function monthStart(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function isMonthStart(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function addMonths(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return monthStart(d);
}
