/**
 * Nombres de la interfaz en español tras el rediseño de la navegación: «burbuja» → «espacio» y «fondo» → «partida».
 * El código conserva sus textos fuente; aquí se reescriben (con su concordancia) al mostrarlos. Cambia solo texto visible.
 */
const RULES: [RegExp, string][] = [
  // ── burbuja(s) → espacio(s)
  [/\b(Nueva) burbuja/g, "Nuevo espacio"], [/\bnueva burbuja/g, "nuevo espacio"],
  [/\bde la burbuja/g, "del espacio"], [/\bDe la burbuja/g, "Del espacio"], [/\ba la burbuja/g, "al espacio"], [/\bA la burbuja/g, "Al espacio"],
  [/\bde una burbuja/g, "de un espacio"], [/\bDe una burbuja/g, "De un espacio"],
  [/\b([Ll])a burbuja/g, (_m: string, c: string) => `${c}el espacio`] as unknown as [RegExp, string],
  [/\b([Uu])na burbuja/g, (_m: string, c: string) => `${c}n espacio`] as unknown as [RegExp, string],
  [/\b([Ee])s(a|ta) burbuja/g, (_m: string, c: string, t: string) => `${c}s${t === "a" ? "e" : "te"} espacio`] as unknown as [RegExp, string],
  [/\b([Ll])as burbujas/g, (_m: string, c: string) => `${c}os espacios`] as unknown as [RegExp, string],
  [/\bburbuja más activa/g, "espacio más activo"], [/\bburbuja compartida/g, "espacio compartido"],
  [/Burbujas/g, "Espacios"], [/burbujas/g, "espacios"], [/Burbuja/g, "Espacio"], [/burbuja/g, "espacio"],
  // ── fondo(s) → partida(s)
  [/\bNuevo fondo/g, "Nueva partida"], [/\bnuevo fondo/g, "nueva partida"], [/\bFondo ajeno/g, "Partida ajena"], [/\bFondo creado/g, "Partida creada"],
  [/\bFondo no válido/g, "Partida no válida"], [/\bFondo automático/g, "Partida automática"],
  [/\bdel fondo/g, "de la partida"], [/\bDel fondo/g, "De la partida"], [/\bal fondo/g, "a la partida"], [/\bAl fondo/g, "A la partida"],
  [/\bde este fondo/g, "de esta partida"], [/\b([Ee])ste fondo/g, (_m: string, c: string) => `${c}sta partida`] as unknown as [RegExp, string], [/\b([Ee])se fondo/g, (_m: string, c: string) => `${c}sa partida`] as unknown as [RegExp, string],
  [/\b([Ee])l fondo/g, (_m: string, c: string) => `${c === "E" ? "L" : "l"}a partida`] as unknown as [RegExp, string],
  [/\b([Uu])n fondo/g, (_m: string, c: string) => `${c}na partida`] as unknown as [RegExp, string],
  [/\b([Ll])os fondos/g, (_m: string, c: string) => `${c}as partidas`] as unknown as [RegExp, string],
  [/\bde los fondos/g, "de las partidas"], [/\bde cada fondo/g, "de cada partida"],
  [/Fondos/g, "Partidas"], [/fondos/g, "partidas"], [/Fondo/g, "Partida"], [/fondo/g, "partida"],
];

export function renameEs(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to as never);
  return out;
}
