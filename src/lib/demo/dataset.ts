import { DEMO_USER_ID, type Db, type Row } from "./fake-client";
import { DEMO_RATES } from "./rates";

/** Datos ficticios de la demo (Ana, Leo, Marta, Iván; "Casa de Ana y Leo", "Viaje Lisboa"). Se generan en memoria respecto a la fecha de hoy. */
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86400000;

export function buildDemoDb(now: Date = new Date()): Db {
  const todayIso = iso(now.getTime());
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const y = now.getUTCFullYear(), m0 = now.getUTCMonth();
  const monthStart = (back: number) => iso(Date.UTC(y, m0 - back, 1));
  const dim = (back: number) => new Date(Date.UTC(y, m0 - back + 1, 0)).getUTCDate();
  let seed = 7;
  const rnd = (lo: number, hi: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return lo + Math.round((seed / 2147483648) * (hi - lo)); };
  let n = 100;
  const id = () => uuid(n++);

  const db: Db = {};
  const add = (t: string, row: Row) => { (db[t] ??= []).push(row); return row; };
  for (const t of ["accounts", "account_transfers", "account_adjustments", "spaces", "space_members", "profiles", "funds", "categories", "expenses", "expense_splits", "expense_payers", "expense_tags", "tags", "expense_comments", "expense_reactions", "expense_private_details", "audit_log", "incomes", "monthly_plans", "plan_incomes", "plan_allocations", "recurring_expenses", "recurring_skips", "savings_goals", "goal_contributions", "goal_milestones", "saving_rules", "personal_mirror", "mirror_prefs", "favorites", "category_rules", "loans", "loan_repayments", "shopping_lists", "shopping_items", "settlements", "cross_offsets", "cross_offset_lines", "contributions", "contribution_rules", "notification_prefs", "notification_log", "push_subscriptions", "share_links", "fx_rates"]) db[t] = [];

  add("profiles", { id: DEMO_USER_ID, display_name: "Ana", locale: "es", discreet_mode: false, ai_phrases: false, avatar_color: "#A78BFA" });
  add("notification_prefs", { user_id: DEMO_USER_ID, new_expense: true, fixed_tomorrow: true, fund_threshold: true, goal_reached: true, monthly_summary: true, contribution_pending: true, offset_proposal: true, daily_reminder: false, reminder_hour: 21, timezone: "Europe/Madrid", fixed_advance_days: 1 });

  // ───── Burbujas y miembros
  const P = uuid(10), H = uuid(11), G = uuid(12);
  const created = `${monthStart(8)}T09:00:00Z`;
  add("spaces", { id: P, name: "Personal", kind: "personal", emoji: null, base_currency: "EUR", daily_budget_cents: null, archived_at: null, created_by: DEMO_USER_ID, created_at: created });
  add("spaces", { id: H, name: "Casa de Ana y Leo", kind: "household", emoji: "🏠", base_currency: "EUR", daily_budget_cents: null, archived_at: null, created_by: DEMO_USER_ID, created_at: `${monthStart(7)}T09:00:00Z` });
  add("spaces", { id: G, name: "Viaje Lisboa", kind: "group", emoji: "✈️", base_currency: "EUR", daily_budget_cents: 5000, archived_at: null, created_by: DEMO_USER_ID, created_at: `${iso(today - 20 * DAY)}T09:00:00Z` });
  const member = (space: string, uid: string | null, name: string, role: string, n2: number, bp: number | null = null) =>
    add("space_members", { id: uuid(n2), space_id: space, user_id: uid, display_name: name, role, default_share_bp: bp, joined_at: created });
  const pAna = member(P, DEMO_USER_ID, "Ana", "owner", 20).id as string;
  const hAna = member(H, DEMO_USER_ID, "Ana", "owner", 21, 5000).id as string;
  const hLeo = member(H, uuid(2), "Leo", "member", 22, 5000).id as string;
  const gAna = member(G, DEMO_USER_ID, "Ana", "owner", 23).id as string;
  const gLeo = member(G, uuid(2), "Leo", "member", 24).id as string;
  const gMarta = member(G, uuid(3), "Marta", "member", 25).id as string;
  const gIvan = member(G, null, "Iván", "member", 26).id as string;

  // ───── Fondos y categorías (con system_key: la interfaz los traduce)
  type FundKey = "fixed" | "daily" | "leisure" | "savings" | "general";
  const FUND = { fixed: ["Gastos fijos", "fixed", "#9AA3AF"], daily: ["Día a día", "variable", "#7DD3FC"], leisure: ["Ocio", "leisure", "#FDBA74"], savings: ["Ahorro", "savings", "#A78BFA"], general: ["General", "other", "#FF9F43"] } as const;
  const fundsOf: Record<string, Record<string, string>> = { [P]: {}, [H]: {}, [G]: {} };
  const catsOf: Record<string, Record<string, string>> = { [P]: {}, [H]: {}, [G]: {} };
  const mkFunds = (space: string, keys: FundKey[]) => keys.forEach((k, i) => { fundsOf[space]![k] = add("funds", { id: id(), space_id: space, name: FUND[k][0], kind: FUND[k][1], color: FUND[k][2], icon: null, rollover: false, linked_space_id: null, position: i, system_key: `fund.${k === "general" ? "general" : k}` }).id as string; });
  const mkCats = (space: string, fund: FundKey, list: [string, string][]) => list.forEach(([key, name]) => { catsOf[space]![key] = add("categories", { id: id(), space_id: space, fund_id: fundsOf[space]![fund], name, system_key: `cat.${key}` }).id as string; });
  mkFunds(P, ["fixed", "daily", "leisure", "savings"]); mkFunds(H, ["fixed", "daily", "leisure", "savings"]); mkFunds(G, ["general"]);
  for (const s of [P, H]) {
    mkCats(s, "fixed", [["rent", "Alquiler"], ["electricity", "Luz"], ["water", "Agua"], ["internet", "Internet"], ["subscriptions", "Suscripciones"]]);
    mkCats(s, "daily", [["groceries", "Supermercado"], ["transport", "Transporte"], ["health", "Salud"], ["home", "Casa"]]);
    mkCats(s, "leisure", [["outings", "Salidas"], ["restaurants", "Restaurantes"], ["shopping", "Compras"], ["trips", "Viajes"]]);
    mkCats(s, "savings", [["savings", "Ahorro"]]);
  }
  mkCats(G, "general", [["lodging", "Alojamiento"], ["transport", "Transporte"], ["food", "Comida"], ["activities", "Actividades"], ["shopping", "Compras"], ["other", "Otros"]]);

  // ───── Gastos (con reparto y pagador)
  const split = (total: number, ids: string[]) => { const base = Math.floor(total / ids.length); let rest = total - base * ids.length; return ids.map((m) => ({ member: m, cents: base + (rest-- > 0 ? 1 : 0) })); };
  const expense = (space: string, byMember: string, participants: string[], date: string, desc: string, cents: number, cat: string, extra: Row = {}) => {
    const e = add("expenses", { id: id(), client_id: id(), space_id: space, description: desc, category_id: catsOf[space]![cat] ?? null, spent_at: date, amount_cents: cents, currency: "EUR", fx_rate: 1, amount_base_cents: cents,
      paid_from: "member", split_mode: "equal", is_private: false, created_by_member: byMember, created_at: `${date}T12:00:00Z`, recurring_id: null, ...extra });
    add("expense_payers", { expense_id: e.id, member_id: byMember, amount_cents: cents });
    for (const s of split(cents, participants)) add("expense_splits", { expense_id: e.id, member_id: s.member, share_bp: Math.round(10000 / participants.length), amount_cents: s.cents });
    return e;
  };
  const upTo = (back: number, day: number) => (back > 0 ? Math.min(day, dim(back)) : day) <= (back === 0 ? now.getUTCDate() : 31);
  const on = (back: number, day: number) => iso(Date.UTC(y, m0 - back, Math.min(day, dim(back))));
  const both = [hAna, hLeo];
  for (let back = 5; back >= 0; back--) {
    const item = (day: number, desc: string, cents: number, cat: string) => { if (upTo(back, day)) expense(P, pAna, [pAna], on(back, day), desc, cents, cat); };
    item(1, "Alquiler", 65000, "rent"); item(1, "Hucha mensual", 30000, "savings"); item(2, "Spotify", 1099, "subscriptions"); item(3, "Internet", 3490, "internet"); item(5, "Gimnasio", 3500, "subscriptions");
    item(8, "Luz", rnd(5200, 6500), "electricity"); item(4, "Supermercado", rnd(4800, 7200), "groceries"); item(11, "Supermercado", rnd(5200, 9200), "groceries"); item(18, "Supermercado", rnd(4500, 8000), "groceries");
    item(6, "Transporte", rnd(1800, 4500), "transport"); item(15, "Gasolina", rnd(3500, 5000), "transport"); item(9, "Cena con amigas", rnd(2500, 4800), "restaurants"); item(20, "Brunch", rnd(1200, 2400), "restaurants");
    item(14, "Cine", rnd(900, 1500), "outings"); item(22, "Concierto", rnd(3500, 7800), "outings"); if (back % 2 === 0) item(12, "Farmacia", rnd(900, 2400), "health");
    const hItem = (day: number, by: string, desc: string, cents: number, cat: string) => { if (upTo(back, day)) expense(H, by, both, on(back, day), desc, cents, cat); };
    hItem(1, hAna, "Alquiler", 90000, "rent"); hItem(1, hAna, "Fondo de ahorro común", 60000, "savings"); hItem(2, hLeo, "Comunidad", 4500, "home"); hItem(5, hLeo, "Internet", 3490, "internet"); hItem(9, hAna, "Luz y agua", rnd(10500, 12800), "electricity");
    hItem(6, hLeo, "Supermercado", rnd(6500, 11000), "groceries"); hItem(13, hAna, "Supermercado", rnd(6000, 10500), "groceries"); hItem(21, hLeo, "Supermercado", rnd(5500, 9500), "groceries"); hItem(16, hAna, "Cena fuera", rnd(4500, 7500), "restaurants"); hItem(24, hLeo, "Cine", rnd(1800, 2600), "outings");
  }
  // Movimientos recientes (para que haya "Hoy", "Ayer" y días sueltos)
  const rel = (days: number) => iso(today - days * DAY);
  expense(P, pAna, [pAna], rel(1), "Café", 250, "restaurants"); expense(P, pAna, [pAna], rel(3), "Supermercado", 5230, "groceries"); expense(P, pAna, [pAna], rel(5), "Cine", 1100, "outings");
  expense(H, hLeo, both, rel(2), "Supermercado", 8420, "groceries"); expense(H, hAna, both, rel(4), "Cena fuera", 4200, "restaurants");
  const lisbon: [number, string, string, number, string, string[]][] = [
    [13, gAna, "Apartamento", 36000, "lodging", [gAna, gLeo, gMarta, gIvan]], [12, gLeo, "Cena en Alfama", 12840, "food", [gAna, gLeo, gMarta, gIvan]],
    [11, gMarta, "Tuk tuk", 6000, "transport", [gAna, gLeo, gMarta]], [11, gIvan, "Pastelería", 1480, "food", [gAna, gLeo, gMarta, gIvan]], [9, gAna, "Entradas al museo", 4800, "activities", [gAna, gLeo, gMarta, gIvan]],
  ];
  const lisbonExpenses = lisbon.map(([ago, by, desc, cents, cat, parts]) => expense(G, by, parts, rel(ago), desc, cents, cat));
  add("expense_comments", { id: id(), expense_id: lisbonExpenses[1]!.id, space_id: G, member_id: gMarta, body: "¡Qué cena tan buena!", created_at: `${rel(12)}T22:00:00Z` });
  add("expense_reactions", { expense_id: lisbonExpenses[1]!.id, member_id: gLeo, emoji: "🔥" });

  // Tu parte del viaje, reflejada en la burbuja personal (en Ocio); el hogar no se refleja
  for (const e of lisbonExpenses) {
    const s = db.expense_splits!.find((q) => q.expense_id === e.id && q.member_id === gAna);
    if (s) add("personal_mirror", { id: id(), user_id: DEMO_USER_ID, source_expense_id: e.id, personal_space_id: P, fund_id: fundsOf[P]!.leisure, amount_cents: s.amount_cents, spent_at: e.spent_at, label: e.description, enabled: true });
  }
  add("mirror_prefs", { user_id: DEMO_USER_ID, space_id: H, enabled: false, fund_id: fundsOf[P]!.daily });
  add("mirror_prefs", { user_id: DEMO_USER_ID, space_id: G, enabled: true, fund_id: fundsOf[P]!.leisure });

  // ───── Ingresos y planes de 6 meses
  for (let back = 5; back >= 0; back--) {
    add("incomes", { id: id(), space_id: P, member_id: pAna, amount_cents: 210000, currency: "EUR", source: "Nómina", received_at: monthStart(back), is_recurring: true });
    add("incomes", { id: id(), space_id: H, member_id: hAna, amount_cents: 190000, currency: "EUR", source: "Nómina", received_at: monthStart(back), is_recurring: true });
    add("incomes", { id: id(), space_id: H, member_id: hLeo, amount_cents: 190000, currency: "EUR", source: "Nómina", received_at: monthStart(back), is_recurring: true });
    const plan = (space: string, incomes: [string, number][], alloc: Partial<Record<FundKey, number>>) => {
      const p = add("monthly_plans", { id: id(), space_id: space, month: monthStart(back), status: back === 0 ? "active" : "closed", notes: null });
      for (const [member2, cents] of incomes) add("plan_incomes", { plan_id: p.id, member_id: member2, expected_cents: cents });
      for (const [k, v] of Object.entries(alloc)) add("plan_allocations", { plan_id: p.id, fund_id: fundsOf[space]![k], mode: "amount", value: v, planned_cents: v, carry_cents: 0 });
    };
    plan(P, [[pAna, 210000]], { fixed: 90000, daily: 45000, leisure: 25000, savings: 30000 });
    plan(H, [[hAna, 190000], [hLeo, 190000]], { fixed: 150000, daily: 80000, leisure: 40000, savings: 60000 });
  }
  const gp = add("monthly_plans", { id: id(), space_id: G, month: monthStart(0), status: "active", notes: null });
  add("plan_allocations", { plan_id: gp.id, fund_id: fundsOf[G]!.general, mode: "amount", value: 120000, planned_cents: 120000, carry_cents: 0 });

  // ───── Gastos fijos (con turnos en el hogar)
  const nextRun = (day: number) => { const d = Math.min(day, 28); const thisMonth = Date.UTC(y, m0, d); return iso(thisMonth >= today ? thisMonth : Date.UTC(y, m0 + 1, d)); };
  const rec = (space: string, by: string, cat: string, desc: string, cents: number, day: number, extra: Row = {}) => add("recurring_expenses", { id: id(), space_id: space, fund_id: db.categories!.find((c) => c.id === catsOf[space]![cat])?.fund_id ?? null, category_id: catsOf[space]![cat], description: desc, amount_cents: cents, frequency: "monthly", day, next_run: nextRun(day), active: true, detected: false, payer_member_id: by, paid_from: "member", rotation: [], rotation_pos: 0, created_at: created, ...extra });
  rec(P, pAna, "subscriptions", "Spotify", 1099, Math.min(28, now.getUTCDate() + 1)); rec(P, pAna, "rent", "Alquiler", 65000, 1); rec(P, pAna, "subscriptions", "Gimnasio", 3500, 10); rec(P, pAna, "electricity", "Luz", 5890, 15);
  rec(H, hAna, "rent", "Alquiler", 90000, 1); rec(H, hLeo, "internet", "Internet", 3490, 5); rec(H, hAna, "electricity", "Luz y agua", 11800, 9);
  rec(H, hAna, "home", "Limpieza", 6000, 20, { rotation: [hAna, hLeo], rotation_pos: 0 });

  // ───── Metas de ahorro (cada burbuja con sus aportaciones: en Personal solo Ana)
  const goal = (space: string, name: string, target: number, kind: string, deadline: string | null, emoji: string | null) => add("savings_goals", { id: id(), space_id: space, name, target_cents: target, deadline, emoji, kind, created_at: created });
  const contrib = (g: Row, space: string, by: string, cents: number, date: string, source = "manual") => add("goal_contributions", { id: id(), goal_id: g.id, space_id: space, member_id: by, amount_cents: cents, source, contributed_at: date, created_at: `${date}T10:00:00Z` });
  const cushion = goal(P, "Colchón de emergencia", 300000, "simple", null, "🛟");
  for (const back of [5, 3, 1]) contrib(cushion, P, pAna, 100000, on(back, 3));
  const japan = goal(P, "Viaje a Japón", 300000, "simple", iso(today + 300 * DAY), "🗾");
  for (const back of [3, 2, 1]) contrib(japan, P, pAna, 40000, on(back, 12));
  const challenge = goal(P, "Reto de las 52 semanas", 137800, "challenge", null, null);
  add("saving_rules", { id: id(), space_id: P, goal_id: challenge.id, kind: "weekly_challenge", value: 100, active: true });
  [[21, 100], [14, 200], [7, 300]].forEach(([ago, c]) => contrib(challenge, P, pAna, c! * 100, rel(ago!), "challenge"));
  const car = goal(H, "Entrada del coche", 500000, "simple", iso(today + 240 * DAY), "🚗");
  [[3, hAna, 60000], [3, hLeo, 40000], [2, hAna, 60000], [2, hLeo, 40000], [1, hAna, 60000], [1, hLeo, 40000]].forEach(([back, by, c]) => contrib(car, H, by as string, c as number, on(back as number, 4)));

  // ───── Lista de la compra, préstamos, favoritos y reglas
  const list = add("shopping_lists", { id: id(), space_id: H, created_at: `${rel(2)}T10:00:00Z`, closed_at: null });
  [["Leche", 2, false, hAna], ["Pan", 1, false, hLeo], ["Tomates", 1, true, hAna], ["Café", 1, false, hLeo]].forEach(([t, q, c, by], i) => add("shopping_items", { id: id(), list_id: list.id, space_id: H, text: t, quantity: q, checked: c, added_by: by === hAna ? DEMO_USER_ID : uuid(2), created_at: `${rel(2)}T10:0${i}:00Z` }));
  const loan = add("loans", { id: id(), user_id: DEMO_USER_ID, direction: "lent", person_name: "Marta", linked_user_id: null, shared: false, amount_cents: 5000, loan_date: rel(25), remind_on: rel(-5), note: "Entradas del concierto", created_at: `${rel(25)}T10:00:00Z` });
  loan.currency = "EUR";
  add("loan_repayments", { id: id(), loan_id: loan.id, user_id: DEMO_USER_ID, amount_cents: 2000, paid_on: rel(10), created_at: `${rel(10)}T10:00:00Z` });
  add("favorites", { id: id(), user_id: DEMO_USER_ID, space_id: P, label: "Café", amount_cents: 250, category_id: catsOf[P]!.restaurants });
  add("category_rules", { id: id(), space_id: P, match_text: "Mercadona", match_type: "contains", category_id: catsOf[P]!.groceries, fund_id: null, priority: 10, created_by: DEMO_USER_ID, created_at: created });

  // ───── Aportaciones al bote del hogar
  add("contribution_rules", { space_id: H, mode: "proportional_to_income", monthly_target_cents: 100000, values: {} });
  add("contributions", { id: id(), space_id: H, member_id: hAna, month: monthStart(0), expected_cents: 50000, paid_cents: 50000 });
  add("contributions", { id: id(), space_id: H, member_id: hLeo, month: monthStart(0), expected_cents: 50000, paid_cents: 20000 });

  // ───── Cuentas ficticias, traspasos y reparto de la nómina (Fifti no se conecta a ningún banco)
  const acc = (space: string, name: string, bank: string, color: string, kind: string, opening: number, isDefault: boolean, currency = "EUR") =>
    add("accounts", { id: id(), space_id: space, owner_user_id: DEMO_USER_ID, name, bank, color, kind, currency, opening_cents: opening, opening_date: monthStart(5), is_default: isDefault, archived_at: null, created_at: created }).id as string;
  const aNom = acc(P, "Santander nómina", "Santander", "#EC0000", "payroll", 320000, true);
  const aRev = acc(P, "Revolut día a día", "Revolut", "#7DD3FC", "daily", 40000, false);
  const aIng = acc(P, "ING ahorro", "ING", "#FDBA74", "savings", 600000, false);
  const aCom = acc(H, "Cuenta común", "BBVA", "#C8F060", "shared", 150000, false);
  const fundKindOf = new Map((db.funds ?? []).map((f) => [f.id as string, f.kind as string]));
  const catFund = new Map((db.categories ?? []).map((c) => [c.id as string, c.fund_id as string]));
  for (const e of db.expenses ?? []) {
    if (e.space_id === P) { const k = fundKindOf.get(catFund.get(e.category_id as string) ?? "") ?? "fixed"; e.account_id = k === "variable" || k === "leisure" ? aRev : k === "savings" ? aIng : aNom; }
    else if (e.space_id === H && e.paid_from === "pot") e.account_id = aCom;
  }
  for (const i of db.incomes ?? []) if (i.space_id === P) i.account_id = aNom;
  for (const f of db.funds ?? []) if (f.space_id === P) f.account_id = f.kind === "fixed" ? aNom : f.kind === "savings" ? aIng : aRev;
  // Viaje a Australia (inventado): una cuenta en dólares australianos y gastos en otras monedas, con los cambios de la demo
  const aAud = acc(P, "Cuenta en Australia", "Banco Austral", "#34D399", "daily", 120000, false, "AUD");
  const foreign = (ago: number, desc: string, original: number, currency: string, cat: string, accountId: string, accountCents: number) => {
    const rate = DEMO_RATES[currency]!;
    expense(P, pAna, [pAna], rel(ago), desc, Math.round(original * rate), cat, { amount_cents: original, currency, fx_rate: rate, account_id: accountId, account_cents: accountCents });
  };
  foreign(2, "Brunch en Melbourne", 3200, "AUD", "restaurants", aAud, 3200);
  foreign(6, "Auriculares (web de EE. UU.)", 4500, "USD", "shopping", aRev, Math.round(4500 * DEMO_RATES.USD!));
  const tr = (from: string, to: string, cents: number, date: string, source: string, note: string) =>
    add("account_transfers", { id: id(), user_id: DEMO_USER_ID, from_account: from, to_account: to, amount_cents: cents, transfer_date: date, note, source, created_at: created });
  for (let back = 5; back >= 1; back--) { tr(aNom, aRev, 63000, monthStart(back), "payroll_split", "Reparto de la nómina"); tr(aNom, aIng, 42000, monthStart(back), "payroll_split", "Reparto de la nómina"); tr(aNom, aCom, 50000, monthStart(back), "household_contribution", "Aportación al hogar"); }
  tr(aNom, aRev, 63000, monthStart(0), "payroll_split", "Reparto de la nómina"); // este mes queda pendiente el traspaso a ING
  tr(aNom, aCom, 50000, monthStart(0), "household_contribution", "Aportación al hogar");
  add("account_adjustments", { id: id(), account_id: aRev, amount_cents: -1250, adjust_date: monthStart(1), note: "Ajuste de saldo", created_by: DEMO_USER_ID, created_at: created });
  return db;
}
