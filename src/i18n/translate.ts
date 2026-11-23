import enUi from "../../messages/en-ui.json";

export type Translate = (es: string) => string;

/** Traductor puro (sin depender de la petición): útil en cron y avisos, donde el idioma es el del destinatario. */
export function translatorFor(locale: string | null | undefined): Translate {
  const dict = enUi as Record<string, string>;
  return locale === "en" ? (es) => dict[es] ?? es : (es) => es;
}
