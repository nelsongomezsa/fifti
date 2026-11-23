import { translatorFor, type Translate } from "./translate";

export type PushPayload = { title: string; body: string; url: string };
/** Texto fijo, o función que recibe el traductor del idioma de quien lo recibe (así los nombres que puso el usuario no se traducen). */
export type PushContent = PushPayload | ((x: Translate) => PushPayload);

/** Escribe el aviso en el idioma del destinatario (`profiles.locale`). Los textos siguen siendo genéricos, sin importes. */
export function localizePayload(content: PushContent, locale: string | null | undefined): PushPayload {
  return typeof content === "function" ? content(translatorFor(locale)) : content;
}
