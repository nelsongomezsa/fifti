import { parseToCents } from "@/lib/money";

/** Analizador local de frases ("23 cena con Leo a medias"). Funciones puras, sin red ni IA. */
export type NlSpace = {
  id: string; name: string; kind: "personal" | "household" | "group"; meId: string;
  members: { id: string; name: string }[]; categories: { id: string; name: string }[];
};
export type NlResult = {
  amountCents?: number;
  description?: string;
  spaceId?: string;
  categoryId?: string;
  /** "equal" = a partes iguales entre `participantIds` */
  splitMode?: "equal";
  participantIds?: string[];
  recurring?: boolean;
};

export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Palabra clave → nombres de categoría posibles (en español e inglés, normalizados). */
const KEYWORDS: [string[], string[]][] = [
  [["super", "supermercado", "mercadona", "carrefour", "lidl", "aldi", "dia", "eroski", "alcampo", "groceries"], ["supermercado", "compra", "groceries"]],
  [["cena", "comida", "restaurante", "comer", "almuerzo", "desayuno", "menu", "dinner", "lunch", "pizza", "sushi", "cafe", "cafeteria", "brunch"], ["restaurantes", "comida", "restaurants", "food"]],
  [["taxi", "uber", "cabify", "bolt", "gasolina", "metro", "bus", "autobus", "tren", "parking", "peaje", "renfe"], ["transporte", "taxi", "transport"]],
  [["farmacia", "medico", "dentista", "psicologo", "gafas", "doctor"], ["salud", "health"]],
  [["netflix", "spotify", "hbo", "disney", "prime", "suscripcion", "youtube", "icloud"], ["suscripciones", "subscriptions"]],
  [["internet", "wifi", "fibra", "movil", "telefono"], ["internet"]],
  [["alquiler", "hipoteca", "renta", "rent"], ["alquiler", "rent"]],
  [["luz", "electricidad", "electricity"], ["luz", "electricity"]],
  [["agua", "water"], ["agua", "water"]],
  [["cine", "copas", "bar", "concierto", "discoteca", "fiesta", "pelicula", "teatro", "museo", "drinks", "cerveza", "cervezas"], ["salidas", "ocio", "outings", "leisure", "copas", "bebida", "drinks"]],
  [["ropa", "zapatos", "zapatillas", "regalo", "amazon", "zara", "shopping"], ["compras", "shopping"]],
  [["viaje", "vuelo", "hotel", "hostal", "airbnb", "apartamento", "trip"], ["viajes", "alojamiento", "trips", "lodging"]],
  [["limpieza", "ikea", "bricolaje", "ferreteria", "muebles"], ["casa", "limpieza", "home", "cleaning"]],
];

/** Importe: primer número que no sea un recuento ("entre 3", "3 personas"). Acepta coma o punto. */
function findAmount(t: string): { cents: number; raw: string } | null {
  const re = /(?<![\d.,])(\d+[.,]\d{1,2}(?!\d)|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+)(?:\s?(?:€|eur|euros?))?(?![\d]|\s?(?:personas?|pers|%|dias|meses|veces))/giu;
  for (const m of t.matchAll(re)) {
    const before = t.slice(0, m.index).trimEnd().toLowerCase();
    if (/(^|\s)(entre|x|por)$/.test(before)) continue;
    const c = parseToCents(/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(m[1]!) ? m[1]!.replace(/\./g, "") : m[1]!);
    if (c && c > 0) return { cents: c, raw: m[0] };
  }
  return null;
}

export function parsePhrase(input: string, spaces: NlSpace[], currentSpaceId: string, rules: { match: (text: string) => string | null } | null = null): NlResult {
  const out: NlResult = {};
  let text = input.trim().slice(0, 200);
  if (!text) return out;

  const amt = findAmount(text);
  if (amt) { out.amountCents = amt.cents; text = text.replace(amt.raw, " "); }

  if (/\b(cada mes|mensual(?:es|mente)?|todos los meses|al mes|cada ano|anual|monthly)\b/.test(norm(text))) {
    out.recurring = true;
    text = text.replace(/\b(cada mes|mensual(?:es|mente)?|todos los meses|al mes|monthly)\b/giu, " ");
  }

  // Burbuja: "en Viaje Lisboa", nombre de grupo/hogar, "personal", o una persona ("con Leo")
  const nt = norm(text);
  const named = spaces.filter((s) => s.kind !== "personal").find((s) => nt.includes(norm(s.name)));
  let space = named ?? (/\b(personal|solo para mi|mio)\b/.test(nt) ? spaces.find((s) => s.kind === "personal") : undefined);
  const others = (s: NlSpace) => s.members.filter((m) => m.id !== s.meId);
  const byPerson = (s: NlSpace) => others(s).filter((m) => new RegExp(`(^|[^\\p{L}])${norm(m.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(nt));
  if (!space) {
    const cur = spaces.find((s) => s.id === currentSpaceId);
    const cands = [cur, ...spaces].filter((s): s is NlSpace => !!s && s.kind !== "personal");
    space = cands.find((s) => byPerson(s).length > 0);
  }
  if (named) text = text.replace(new RegExp(`\\b(en|para)?\\s*${named.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu"), " ");
  const target = space ?? spaces.find((s) => s.id === currentSpaceId) ?? spaces[0];
  if (space) out.spaceId = space.id;

  // Reparto
  if (target && target.kind !== "personal") {
    const named2 = byPerson(target);
    const half = /\b(a medias|a partes iguales|mitad|dividido|splitting|50\/50|entre los dos)\b/.test(nt);
    const mine = /\b(lo pago yo|pago yo|solo yo|es mio|para mi|solo para mi)\b/.test(nt);
    const between = nt.match(/\bentre (\d{1,2})\b/);
    if (mine) { out.splitMode = "equal"; out.participantIds = [target.meId]; }
    else if (half || named2.length > 0 || between) {
      out.splitMode = "equal";
      if (named2.length > 0) out.participantIds = [target.meId, ...named2.map((m) => m.id)];
      else if (!between || Number(between[1]) === target.members.length) out.participantIds = target.members.map((m) => m.id);
      else delete out.splitMode; // no sabemos entre quién: se deja el reparto por defecto
    }
  }
  text = text
    .replace(/\b(a medias|a partes iguales|lo pago yo|pago yo|solo yo|entre \d{1,2}|entre los dos|solo para mi)\b/giu, " ")
    .replace(/\bcon\s+[\p{L}]+(?:\s+y\s+[\p{L}]+)*/giu, (m) => (target && byPerson(target).length ? " " : m));

  // Concepto y categoría
  const desc = text.replace(/[€]/g, " ").replace(/\s+/g, " ").replace(/^(de|del|en|por|para)\s+/i, "").trim();
  if (desc) out.description = desc.charAt(0).toLocaleUpperCase("es") + desc.slice(1);

  if (target) {
    const words = new Set(norm(`${desc} ${input}`).split(/[^\p{L}\p{N}]+/u));
    const viaRule = rules?.match(desc || input) ?? null;
    if (viaRule && target.categories.some((c) => c.id === viaRule)) out.categoryId = viaRule;
    else {
      for (const [keys, names] of KEYWORDS) {
        if (!keys.some((k) => words.has(k))) continue;
        const cat = names.map((n) => target.categories.find((c) => norm(c.name) === n)).find(Boolean);
        if (cat) { out.categoryId = cat.id; break; }
      }
      if (!out.categoryId) out.categoryId = target.categories.find((c) => words.has(norm(c.name)))?.id;
    }
  }
  return out;
}

/** Categorías genéricas que se le piden a la IA (nunca los nombres propios del usuario) y su equivalente local. */
export const AI_CATEGORIES = {
  groceries: ["supermercado", "compra", "groceries"], restaurants: ["restaurantes", "comida", "restaurants", "food"],
  transport: ["transporte", "taxi", "transport"], health: ["salud", "health"], subscriptions: ["suscripciones", "subscriptions"],
  internet: ["internet"], rent: ["alquiler", "rent"], electricity: ["luz", "electricity"], water: ["agua", "water"],
  leisure: ["salidas", "ocio", "outings", "leisure", "copas", "bebida", "drinks"], shopping: ["compras", "shopping"],
  trips: ["viajes", "alojamiento", "trips", "lodging"], home: ["casa", "limpieza", "home", "cleaning"],
} as const;

export type AiAnswer = {
  amount: number | null; description: string | null; bubble_alias: string | null;
  category: keyof typeof AI_CATEGORIES | null; split: "equal" | "mine" | null; people: string[]; recurring: boolean;
};

/** Convierte la respuesta (ya validada) de la IA en un resultado, sin ningún ID externo: los alias se resuelven aquí. */
export function resolveAi(ai: AiAnswer, spaces: NlSpace[], currentSpaceId: string, aliases: Record<string, string>): NlResult {
  const out: NlResult = {};
  if (ai.amount && ai.amount > 0 && ai.amount < 1e8) out.amountCents = Math.round(ai.amount * 100);
  if (ai.description) out.description = ai.description.trim().slice(0, 80);
  const spaceId = ai.bubble_alias ? aliases[ai.bubble_alias] : undefined;
  const space = spaces.find((s) => s.id === spaceId);
  if (space) out.spaceId = space.id;
  const target = space ?? spaces.find((s) => s.id === currentSpaceId) ?? spaces[0];
  if (target && ai.category) {
    const cat = AI_CATEGORIES[ai.category].map((n) => target.categories.find((c) => norm(c.name) === n)).find(Boolean);
    if (cat) out.categoryId = cat.id;
  }
  if (target && target.kind !== "personal") {
    const named = target.members.filter((m) => m.id !== target.meId && ai.people.some((p) => norm(p) === norm(m.name)));
    if (ai.split === "mine") { out.splitMode = "equal"; out.participantIds = [target.meId]; }
    else if (ai.split === "equal" || named.length) { out.splitMode = "equal"; out.participantIds = named.length ? [target.meId, ...named.map((m) => m.id)] : target.members.map((m) => m.id); }
  }
  if (ai.recurring) out.recurring = true;
  return out;
}

/** El resultado local manda donde acierta; la IA solo rellena lo que el analizador local no ha podido deducir. */
export const mergeResults = (local: NlResult, ai: NlResult): NlResult => ({ ...ai, ...Object.fromEntries(Object.entries(local).filter(([, v]) => v !== undefined)) });
