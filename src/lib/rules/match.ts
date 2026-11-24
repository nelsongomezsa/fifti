/** Reglas de categoría: coincidencia sin mayúsculas, acentos ni espacios repetidos. Funciones puras. */
export type RuleType = "contains" | "starts_with" | "exact";
export type CategoryRule = { id: string; matchText: string; matchType: RuleType; categoryId: string; priority: number };

export const normText = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const SPECIFICITY: Record<RuleType, number> = { exact: 3, starts_with: 2, contains: 1 };

export function ruleMatches(rule: Pick<CategoryRule, "matchText" | "matchType">, text: string): boolean {
  const t = normText(text), m = normText(rule.matchText);
  if (!m || !t) return false;
  return rule.matchType === "exact" ? t === m : rule.matchType === "starts_with" ? t.startsWith(m) : t.includes(m);
}

/** Gana la de menor prioridad (número más bajo); a igualdad, la más específica y luego la de texto más largo. */
export function matchRule(rules: CategoryRule[], text: string): CategoryRule | null {
  const hits = rules.filter((r) => ruleMatches(r, text));
  hits.sort((a, b) => a.priority - b.priority || SPECIFICITY[b.matchType] - SPECIFICITY[a.matchType] || normText(b.matchText).length - normText(a.matchText).length);
  return hits[0] ?? null;
}
