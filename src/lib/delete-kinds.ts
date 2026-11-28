/** Lo que se puede borrar desde una lista, con el aviso que sale al hacerlo. */
export const DELETE_KINDS = [
  "expense", "recurring", "income", "transfer", "adjustment", "goal", "contribution", "saving_rule",
  "loan", "repayment", "rule", "shopping_item", "settlement", "comment", "favorite", "tag",
] as const;

export type DeleteKind = (typeof DELETE_KINDS)[number];

export const DELETED_LABEL: Record<DeleteKind, string> = {
  expense: "Gasto borrado", recurring: "Gasto fijo borrado", income: "Ingreso borrado", transfer: "Traspaso borrado",
  adjustment: "Ajuste borrado", goal: "Meta borrada", contribution: "Aportación borrada", saving_rule: "Regla borrada",
  loan: "Préstamo borrado", repayment: "Devolución borrada", rule: "Regla borrada", shopping_item: "Artículo borrado",
  settlement: "Pago borrado", comment: "Comentario borrado", favorite: "Favorito borrado", tag: "Etiqueta borrada",
};

/** Lo que alimenta la hoja de «Nuevo gasto», que guarda una copia: al borrarlo hay que pedirla de nuevo. */
export const CHANGES_SHEET_CONTEXT: ReadonlySet<DeleteKind> = new Set(["rule", "favorite"]);
