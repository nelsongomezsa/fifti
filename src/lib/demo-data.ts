/** Datos ficticios y estáticos del modo demo. Nada de esto toca la base de datos. */
export type DemoKind = "personal" | "household" | "group";
export type DemoExpense = { id: string; text: string; cents: number; category: string; day: number; payer: string; participants: string[] };
export type DemoBubble = {
  id: string; name: string; kind: DemoKind; members: string[]; income: number; prevLeftover: number;
  /** Fondos del plan: lo gastado NO se guarda aquí, se calcula sumando los movimientos (así Inicio y Movimientos siempre coinciden). */
  funds: { name: string; color: string; planned: number; savings?: boolean }[]; series: number[]; expenses: DemoExpense[];
};
export type DemoRecurring = { id: string; text: string; cents: number; day: number };
export type DemoGoal = { id: string; name: string; targetCents: number; savedCents: number; contributions: { date: string; cents: number; by: string }[] };

/** Gastos fijos ficticios por burbuja (el día es el del mes). */
export const DEMO_RECURRING: Record<string, DemoRecurring[]> = {
  personal: [{ id: "rp1", text: "Alquiler", cents: 65000, day: 1 }, { id: "rp2", text: "Spotify", cents: 1099, day: 5 }, { id: "rp3", text: "Gimnasio", cents: 3500, day: 10 }, { id: "rp4", text: "Luz", cents: 5890, day: 15 }],
  household: [{ id: "rh1", text: "Alquiler", cents: 90000, day: 1 }, { id: "rh2", text: "Internet", cents: 3490, day: 5 }, { id: "rh3", text: "Luz y agua", cents: 11800, day: 9 }, { id: "rh4", text: "Comunidad", cents: 4500, day: 2 }],
  lisboa: [],
};

const e = (id: string, text: string, cents: number, category: string, day: number, payer: string, participants: string[]): DemoExpense => ({ id, text, cents, category, day, payer, participants });
const AL = ["Ana", "Leo"], ALMI = ["Ana", "Leo", "Marta", "Iván"];

export const DEMO_BUBBLES: DemoBubble[] = [
  {
    id: "personal", name: "Personal", kind: "personal", members: ["Ana"], income: 210000, prevLeftover: 31200,
    funds: [
      { name: "Gastos fijos", color: "#9AA3AF", planned: 90000 },
      { name: "Día a día", color: "#7DD3FC", planned: 40000 },
      { name: "Ocio", color: "#FF9F43", planned: 25000 },
      { name: "Ahorro", color: "#A78BFA", planned: 30000, savings: true },
    ],
    series: [168000, 171500, 159000, 182000, 176400, 0],
    expenses: [
      e("p1", "Alquiler", 62000, "Gastos fijos", 3, "Ana", ["Ana"]), e("p2", "Luz", 5980, "Gastos fijos", 8, "Ana", ["Ana"]),
      e("p3", "Internet", 3490, "Gastos fijos", 5, "Ana", ["Ana"]), e("p4", "Seguro del coche", 12000, "Gastos fijos", 10, "Ana", ["Ana"]),
      e("p5", "Supermercado", 5230, "Día a día", 21, "Ana", ["Ana"]), e("p6", "Supermercado", 9120, "Día a día", 14, "Ana", ["Ana"]),
      e("p7", "Transporte", 4500, "Día a día", 12, "Ana", ["Ana"]), e("p8", "Farmacia", 1840, "Día a día", 9, "Ana", ["Ana"]),
      e("p9", "Café", 250, "Día a día", 20, "Ana", ["Ana"]),
      e("p10", "Cine", 1100, "Ocio", 18, "Ana", ["Ana"]), e("p11", "Cena con amigas", 4200, "Ocio", 16, "Ana", ["Ana"]),
      e("p12", "Concierto", 7800, "Ocio", 7, "Ana", ["Ana"]),
      e("p13", "Hucha mensual", 30000, "Ahorro", 1, "Ana", ["Ana"]),
    ],
  },
  {
    id: "household", name: "Casa de Ana y Leo", kind: "household", members: AL, income: 380000, prevLeftover: 52000,
    funds: [
      { name: "Gastos fijos", color: "#9AA3AF", planned: 150000 },
      { name: "Día a día", color: "#7DD3FC", planned: 80000 },
      { name: "Ocio", color: "#FF9F43", planned: 40000 },
      { name: "Ahorro", color: "#A78BFA", planned: 60000, savings: true },
    ],
    series: [246000, 251000, 238500, 262000, 249000, 0],
    expenses: [
      e("h1", "Alquiler", 90000, "Gastos fijos", 1, "Ana", AL), e("h2", "Internet", 3490, "Gastos fijos", 5, "Leo", AL),
      e("h3", "Luz y agua", 11800, "Gastos fijos", 9, "Ana", AL), e("h4", "Comunidad", 4500, "Gastos fijos", 2, "Leo", AL),
      e("h5", "Supermercado", 8420, "Día a día", 19, "Leo", AL), e("h6", "Supermercado", 11230, "Día a día", 12, "Ana", AL),
      e("h7", "Verdulería", 2480, "Día a día", 15, "Leo", AL),
      e("h8", "Cena fuera", 6400, "Ocio", 16, "Ana", AL), e("h9", "Cine", 2200, "Ocio", 8, "Leo", AL),
      e("h10", "Fondo de ahorro común", 60000, "Ahorro", 1, "Ana", AL),
    ],
  },
  {
    id: "lisboa", name: "Viaje Lisboa", kind: "group", members: ALMI, income: 0, prevLeftover: 0,
    funds: [{ name: "General", color: "#FF9F43", planned: 120000 }], series: [0, 0, 0, 0, 0, 0],
    expenses: [
      e("l1", "Apartamento", 36000, "Alojamiento", 12, "Ana", ALMI),
      e("l2", "Cena en Alfama", 12840, "Comida", 13, "Leo", ALMI),
      e("l3", "Tuk tuk", 6000, "Transporte", 14, "Marta", ["Ana", "Leo", "Marta"]),
      e("l4", "Pastelería", 1480, "Comida", 14, "Iván", ALMI),
    ],
  },
];

export const DEMO_GOALS: DemoGoal[] = [
  { id: "g1", name: "Colchón de emergencia", targetCents: 300000, savedCents: 300000, contributions: [{ date: "2026-06-03", cents: 100000, by: "Ana" }, { date: "2026-08-03", cents: 100000, by: "Ana" }, { date: "2026-10-03", cents: 100000, by: "Ana" }] },
  { id: "g2", name: "Viaje a Japón", targetCents: 300000, savedCents: 120000, contributions: [{ date: "2026-08-12", cents: 40000, by: "Ana" }, { date: "2026-09-12", cents: 40000, by: "Leo" }, { date: "2026-10-12", cents: 40000, by: "Ana" }] },
  { id: "g3", name: "Reto de las 52 semanas", targetCents: 137800, savedCents: 40600, contributions: [{ date: "2026-10-05", cents: 15000, by: "Ana" }, { date: "2026-10-26", cents: 12600, by: "Ana" }, { date: "2026-11-16", cents: 13000, by: "Ana" }] },
];
