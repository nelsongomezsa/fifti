/** Mensaje compartido (el mismo que lanza la base). */
export const TWO_DAYS = "Elige dos días distintos; el primero, como mucho el 27";

/** Lo que llega del formulario para «dos veces al mes», en orden; en las demás frecuencias el segundo día no cuenta. */
export function twoDays(frequency: string, day: number, day2: string): { day: number; day2?: number } {
  if (frequency !== "semimonthly") return { day };
  const other = Number(day2 || day);
  return { day: Math.min(day, other), day2: Math.max(day, other) };
}
