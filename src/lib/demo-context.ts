import type { SheetContext } from "@/server/actions/sheet";
import { DEMO_BUBBLES } from "./demo-data";

const GROUP_CATEGORIES = ["Alojamiento", "Comida", "Transporte", "Ocio", "Otros"];

/** Contexto ficticio para la hoja real de "Nuevo gasto" en la demo (burbujas, miembros y categorías estáticos). */
export function buildDemoContext(): SheetContext {
  return {
    favorites: [],
    spaces: DEMO_BUBBLES.map((b) => {
      const cats = b.kind === "group" ? GROUP_CATEGORIES : b.funds.map((f) => f.name);
      const colors = b.funds.map((f) => f.color);
      return {
        id: b.id, name: b.name, kind: b.kind, currency: "EUR", meId: `${b.id}:${b.members[0]}`,
        members: b.members.map((m, i) => ({ id: `${b.id}:${m}`, name: m, defaultBp: b.kind === "household" ? ([6000, 4000][i] ?? 0) : null })),
        categories: cats.map((c, i) => ({ id: `${b.id}:c:${c}`, name: c, fundName: c, fundColor: colors[i] ?? "#FF9F43" })),
        topCategoryId: null, rules: [], // sin historial: ninguna categoría preseleccionada
      };
    }),
  };
}
