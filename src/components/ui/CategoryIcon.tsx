import { createElement } from "react";
import { Bed, Car, Coins, Droplets, GlassWater, HeartPulse, Home, IceCream, PartyPopper, PiggyBank, Plane, Repeat, ShieldAlert, ShoppingBag, ShoppingCart, Smile, Sofa, Sparkles, Tag, Ticket, TrendingUp, Users, Utensils, UtensilsCrossed, Wifi, Wine, Zap, type LucideIcon } from "lucide-react";

/** Un icono por categoría (siempre de la misma familia) que se usa igual en listas, detalles y gráficas. */
const BY_SYSTEM: Record<string, LucideIcon> = {
  "cat.rent": Home, "cat.electricity": Zap, "cat.water": Droplets, "cat.internet": Wifi, "cat.subscriptions": Repeat, "cat.groceries": ShoppingCart, "cat.transport": Car,
  "cat.health": HeartPulse, "cat.home": Sofa, "cat.outings": PartyPopper, "cat.restaurants": UtensilsCrossed, "cat.shopping": ShoppingBag, "cat.trips": Plane, "cat.savings": PiggyBank,
  "cat.emergency": ShieldAlert, "cat.investment": TrendingUp, "cat.household_contribution": Users, "cat.food": Utensils, "cat.drinks": GlassWater, "cat.taxi": Car, "cat.lodging": Bed,
  "cat.activities": Ticket, "cat.tickets": Ticket, "cat.cocktails": Wine, "cat.dessert": IceCream, "cat.tip": Coins, "cat.cleaning": Sparkles, "cat.purchase": ShoppingCart, "cat.leisure": Smile,
};

export const categoryIcon = (systemName: string | null | undefined): LucideIcon => (systemName && BY_SYSTEM[systemName]) || Tag;

const tint = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}2e` : "var(--surface-2)");

/** Icono redondo con el color del fondo de la categoría. Es decorativo: el nombre va siempre en texto al lado. */
export function CategoryIcon({ systemName, color = "#9AA3AF", size = 40 }: { systemName?: string | null; color?: string; size?: number }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: tint(color), color }}>
      {createElement(categoryIcon(systemName), { size: Math.round(size * 0.5), strokeWidth: 2 })}
    </span>
  );
}
