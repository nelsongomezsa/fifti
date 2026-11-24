/** Nombres de fábrica (en español) de los fondos y categorías del sistema, por clave interna (`system_key`). La interfaz los traduce según el idioma. */
export const SYSTEM_NAMES: Record<string, string> = {
  "fund.fixed": "Fijos", "fund.daily": "Día a día", "fund.leisure": "Ocio", "fund.savings": "Ahorro", "fund.emergency": "Imprevistos",
  "fund.investment": "Inversión", "fund.contribution": "Aportación al hogar", "fund.general": "General",
  "cat.rent": "Alquiler", "cat.electricity": "Luz", "cat.water": "Agua", "cat.internet": "Internet", "cat.subscriptions": "Suscripciones",
  "cat.groceries": "Supermercado", "cat.transport": "Transporte", "cat.health": "Salud", "cat.home": "Casa",
  "cat.outings": "Salidas", "cat.restaurants": "Restaurantes", "cat.shopping": "Compras", "cat.trips": "Viajes",
  "cat.savings": "Ahorro", "cat.emergency": "Imprevistos", "cat.investment": "Inversión", "cat.household_contribution": "Aportación al hogar",
  "cat.food": "Comida", "cat.drinks": "Bebida", "cat.lodging": "Alojamiento", "cat.leisure": "Ocio", "cat.other": "Otros",
  "cat.cocktails": "Copas", "cat.tickets": "Entradas", "cat.taxi": "Taxi", "cat.dessert": "Postre", "cat.tip": "Propina",
  "cat.activities": "Actividades", "cat.purchase": "Compra", "cat.cleaning": "Limpieza",
};

/** Nombre a mostrar: los del sistema se traducen con `x`; los que creó el usuario (sin clave) se muestran tal cual. */
export function displayName(x: (es: string) => string, name: string, systemKey?: string | null): string {
  const base = systemKey ? SYSTEM_NAMES[systemKey] : undefined;
  return base ? x(base) : name;
}
