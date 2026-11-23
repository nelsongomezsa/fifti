/** Datos ficticios y estáticos del modo demo. Nada de esto toca la base de datos. */
export type DemoKind = "personal" | "household" | "group";
export type DemoExpense = { id: string; text: string; cents: number; category: string; day: number; payer: string; participants: string[] };
export type DemoBubble = {
  id: string; name: string; kind: DemoKind; members: string[]; income: number; prevLeftover: number;
  funds: { name: string; color: string; planned: number; spent: number }[]; series: number[]; expenses: DemoExpense[];
};

const e = (id: string, text: string, cents: number, category: string, day: number, payer: string, participants: string[]): DemoExpense => ({ id, text, cents, category, day, payer, participants });

export const DEMO_BUBBLES: DemoBubble[] = [
  {
    id: "personal", name: "Personal", kind: "personal", members: ["Ana"], income: 210000, prevLeftover: 31200,
    funds: [
      { name: "Gastos fijos", color: "#9AA3AF", planned: 90000, spent: 84500 },
      { name: "Día a día", color: "#7DD3FC", planned: 40000, spent: 33100 },
      { name: "Ocio", color: "#FF9F43", planned: 25000, spent: 27800 },
      { name: "Ahorro", color: "#A78BFA", planned: 30000, spent: 30000 },
    ],
    series: [168000, 171500, 159000, 182000, 176400, 175400],
    expenses: [e("p1", "Supermercado", 5230, "Día a día", 21, "Ana", ["Ana"]), e("p2", "Café", 250, "Día a día", 20, "Ana", ["Ana"]), e("p3", "Cine", 1100, "Ocio", 18, "Ana", ["Ana"])],
  },
  {
    id: "household", name: "Casa de Ana y Leo", kind: "household", members: ["Ana", "Leo"], income: 380000, prevLeftover: 52000,
    funds: [
      { name: "Gastos fijos", color: "#9AA3AF", planned: 150000, spent: 148200 },
      { name: "Día a día", color: "#7DD3FC", planned: 80000, spent: 66400 },
      { name: "Ocio", color: "#FF9F43", planned: 40000, spent: 21000 },
      { name: "Imprevistos", color: "#FF6B6B", planned: 20000, spent: 0 },
    ],
    series: [246000, 251000, 238500, 262000, 249000, 235600],
    expenses: [e("h1", "Alquiler", 90000, "Gastos fijos", 1, "Ana", ["Ana", "Leo"]), e("h2", "Supermercado", 8420, "Día a día", 19, "Leo", ["Ana", "Leo"]), e("h3", "Internet", 3490, "Gastos fijos", 5, "Leo", ["Ana", "Leo"])],
  },
  {
    id: "lisboa", name: "Viaje Lisboa", kind: "group", members: ["Ana", "Leo", "Marta", "Iván"], income: 0, prevLeftover: 0,
    funds: [{ name: "General", color: "#FF9F43", planned: 120000, spent: 64320 }], series: [0, 0, 0, 0, 0, 64320],
    expenses: [
      e("l1", "Apartamento", 36000, "Alojamiento", 12, "Ana", ["Ana", "Leo", "Marta", "Iván"]),
      e("l2", "Cena en Alfama", 12840, "Comida", 13, "Leo", ["Ana", "Leo", "Marta", "Iván"]),
      e("l3", "Tuk tuk", 6000, "Transporte", 14, "Marta", ["Ana", "Leo", "Marta"]),
      e("l4", "Pastelería", 1480, "Comida", 14, "Iván", ["Ana", "Leo", "Marta", "Iván"]),
    ],
  },
];
