/**
 * Proveedor de datos en memoria para la demo: imita lo que la app usa de `@supabase/supabase-js`
 * (from/select con relaciones, filtros, orden, límites, rpc de lectura y auth.getUser).
 * Es de SOLO LECTURA: cualquier escritura devuelve el error DEMO ("Crea una cuenta para guardar"). No toca la red ni la base de datos.
 */
export type Row = Record<string, unknown>;
export type Db = Record<string, Row[]>;

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_ERROR = { code: "DEMO", message: "Crea una cuenta para guardar", details: null, hint: null };

/** Relaciones entre tablas: columna → tabla a la que apunta. Sirve para resolver `tabla(columnas)` en los select. */
const FK: Record<string, Record<string, string>> = {
  space_members: { space_id: "spaces" }, funds: { space_id: "spaces" }, categories: { space_id: "spaces", fund_id: "funds" },
  expenses: { space_id: "spaces", category_id: "categories", created_by_member: "space_members" },
  expense_splits: { expense_id: "expenses", member_id: "space_members" }, expense_payers: { expense_id: "expenses", member_id: "space_members" },
  expense_tags: { expense_id: "expenses", tag_id: "tags" }, expense_comments: { expense_id: "expenses", member_id: "space_members" }, expense_reactions: { expense_id: "expenses", member_id: "space_members" },
  monthly_plans: { space_id: "spaces" }, plan_incomes: { plan_id: "monthly_plans", member_id: "space_members" }, plan_allocations: { plan_id: "monthly_plans", fund_id: "funds" },
  incomes: { space_id: "spaces", member_id: "space_members" }, recurring_expenses: { space_id: "spaces", category_id: "categories", fund_id: "funds" },
  savings_goals: { space_id: "spaces" }, goal_contributions: { goal_id: "savings_goals", member_id: "space_members" }, goal_milestones: { goal_id: "savings_goals" }, saving_rules: { goal_id: "savings_goals" },
  shopping_lists: { space_id: "spaces" }, shopping_items: { list_id: "shopping_lists", space_id: "spaces" }, settlements: { space_id: "spaces" },
  personal_mirror: { fund_id: "funds" }, favorites: { space_id: "spaces", category_id: "categories" }, category_rules: { space_id: "spaces", category_id: "categories" },
  loan_repayments: { loan_id: "loans" }, contributions: { member_id: "space_members" }, mirror_prefs: { space_id: "spaces" },
};

type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "ilike" | "not";
type Filter = { col: string; op: Op; val: unknown; negate?: boolean } | { or: Filter[] };
type Embed = { name: string; alias: string; inner: boolean; cols: string };

/** Separa una lista de columnas respetando los paréntesis de las relaciones. */
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseSelect(cols: string): { plain: string[]; embeds: Embed[]; star: boolean } {
  const plain: string[] = [], embeds: Embed[] = []; let star = false;
  for (const item of splitTop(cols)) {
    if (item === "*") { star = true; continue; }
    const m = /^(?:(\w+):)?(\w+)(!inner)?\((.*)\)$/s.exec(item);
    if (m) embeds.push({ alias: m[1] ?? m[2]!, name: m[2]!, inner: !!m[3], cols: m[4]! });
    else plain.push(item.includes(":") ? item.split(":")[1]!.trim() : item);
  }
  return { plain, embeds, star };
}

const cmp = (a: unknown, b: unknown) => (a === b ? 0 : (a as string | number) < (b as string | number) ? -1 : 1);

function test(row: Row, f: Filter): boolean {
  if ("or" in f) return f.or.some((g) => test(row, g));
  const v = row[f.col];
  let ok: boolean;
  switch (f.op) {
    case "eq": ok = v === f.val; break;
    case "neq": ok = v !== f.val; break;
    case "gt": ok = v != null && cmp(v, f.val) > 0; break;
    case "gte": ok = v != null && cmp(v, f.val) >= 0; break;
    case "lt": ok = v != null && cmp(v, f.val) < 0; break;
    case "lte": ok = v != null && cmp(v, f.val) <= 0; break;
    case "in": ok = (f.val as unknown[]).includes(v); break;
    case "is": ok = f.val === null ? v == null : v === f.val; break;
    case "ilike": ok = typeof v === "string" && v.toLowerCase().includes(String(f.val).replace(/%/g, "").toLowerCase()); break;
    default: ok = false;
  }
  return f.negate ? !ok : ok;
}

/** `col.op.valor,col.op.valor` de `.or(...)`. */
function parseOr(s: string): Filter[] {
  return splitTop(s).map((part) => {
    const [col, op, ...rest] = part.split(".");
    const raw = rest.join(".");
    if (op === "in") return { col: col!, op: "in" as const, val: raw.replace(/^\(|\)$/g, "").split(",").filter(Boolean) };
    if (op === "is") return { col: col!, op: "is" as const, val: raw === "null" ? null : raw === "true" };
    return { col: col!, op: op as Op, val: raw };
  });
}

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private from = 0;
  private mode: "list" | "one" | "maybe" = "list";
  private cols = "*";
  private count = false;
  private head = false;
  private mutation = false;
  constructor(private db: Db, private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) { this.cols = cols; this.count = !!opts?.count; this.head = !!opts?.head; return this; }
  insert() { this.mutation = true; return this; }
  update() { this.mutation = true; return this; }
  upsert() { this.mutation = true; return this; }
  delete() { this.mutation = true; return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "eq", val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ col, op: "neq", val }); return this; }
  gt(col: string, val: unknown) { this.filters.push({ col, op: "gt", val }); return this; }
  gte(col: string, val: unknown) { this.filters.push({ col, op: "gte", val }); return this; }
  lt(col: string, val: unknown) { this.filters.push({ col, op: "lt", val }); return this; }
  lte(col: string, val: unknown) { this.filters.push({ col, op: "lte", val }); return this; }
  in(col: string, val: unknown[]) { this.filters.push({ col, op: "in", val }); return this; }
  is(col: string, val: unknown) { this.filters.push({ col, op: "is", val }); return this; }
  ilike(col: string, val: string) { this.filters.push({ col, op: "ilike", val }); return this; }
  not(col: string, op: string, val: unknown) {
    const v = op === "in" && typeof val === "string" ? val.replace(/^\(|\)$/g, "").split(",") : val;
    this.filters.push({ col, op: op as Op, val: v, negate: true }); return this;
  }
  or(expr: string) { this.filters.push({ or: parseOr(expr) }); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.from = a; this.lim = b - a + 1; return this; }
  single() { this.mode = "one"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private project(table: string, row: Row, cols: string): Row | null {
    const { plain, embeds, star } = parseSelect(cols);
    const out: Row = star ? { ...row } : {};
    for (const c of plain) out[c] = row[c];
    for (const e of embeds) {
      const rel = this.resolve(table, row, e);
      if (rel === undefined) return null; // !inner sin coincidencia
      out[e.alias] = rel;
    }
    return out;
  }

  private resolve(table: string, row: Row, e: Embed): Row | Row[] | null | undefined {
    const parentCol = Object.entries(FK[table] ?? {}).find(([, target]) => target === e.name)?.[0];
    if (parentCol) {
      const p = (this.db[e.name] ?? []).find((r) => r.id === row[parentCol]);
      if (!p) return e.inner ? undefined : null;
      return this.project(e.name, p, e.cols);
    }
    const childCol = Object.entries(FK[e.name] ?? {}).find(([, target]) => target === table)?.[0];
    if (!childCol) return [];
    const kids = (this.db[e.name] ?? []).filter((r) => r[childCol] === row.id).map((r) => this.project(e.name, r, e.cols)).filter((r): r is Row => r !== null);
    return e.inner && kids.length === 0 ? undefined : kids;
  }

  private run(): { data: unknown; error: unknown; count?: number | null } {
    if (this.mutation) return { data: null, error: DEMO_ERROR };
    const own = this.filters.filter((f) => "or" in f || !f.col.includes("."));
    const emb = this.filters.filter((f): f is Extract<Filter, { col: string }> => !("or" in f) && f.col.includes("."));
    let rows = (this.db[this.table] ?? []).filter((r) => own.every((f) => test(r, f)));
    for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (a[o.col] == null ? 1 : b[o.col] == null ? -1 : cmp(a[o.col], b[o.col]) * (o.asc ? 1 : -1)));
    const total = rows.length;
    rows = rows.slice(this.from, this.lim === null ? undefined : this.from + this.lim);
    if (this.count && this.head) return { data: null, error: null, count: total };
    let out = rows.map((r) => this.project(this.table, r, this.cols)).filter((r): r is Row => r !== null);
    for (const f of emb) {
      const [rel, col] = f.col.split(".") as [string, string];
      out = out.filter((r) => { const o = r[rel]; return o && !Array.isArray(o) ? test(o as Row, { ...f, col }) : true; });
    }
    if (this.mode === "list") return { data: out, error: null, count: this.count ? total : null };
    if (out.length > 1 && this.mode === "one") return { data: null, error: { code: "PGRST116", message: "varias filas" } };
    if (out.length === 0) return this.mode === "one" ? { data: null, error: { code: "PGRST116", message: "sin filas" } } : { data: null, error: null };
    return { data: out[0], error: null };
  }

  then<R1 = { data: unknown; error: unknown; count?: number | null }, R2 = never>(ok?: ((v: { data: unknown; error: unknown; count?: number | null }) => R1 | PromiseLike<R1>) | null, ko?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, ko);
  }
}

const sumBy = (rows: Row[], key: (r: Row) => string | null, val: (r: Row) => number) => {
  const m = new Map<string | null, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r));
  return m;
};
const monthOf = (d: unknown) => `${String(d).slice(0, 7)}-01`;

function rpc(db: Db, name: string, a: Record<string, unknown>) {
  const from = String(a.p_from ?? "0000-01-01");
  const list = (m: Map<string | null, number>, k: string) => [...m.entries()].sort(([x], [y]) => String(x).localeCompare(String(y))).map(([key, total]) => ({ month: k === "month" ? key : undefined, total_cents: total }));
  switch (name) {
    case "monthly_spend": { const r = (db.expenses ?? []).filter((e) => e.space_id === a.p_space && String(e.spent_at) >= from); return [...sumBy(r, (e) => monthOf(e.spent_at), (e) => Number(e.amount_base_cents))].sort(([x], [y]) => String(x).localeCompare(String(y))).map(([month, total_cents]) => ({ month, total_cents })); }
    case "monthly_income": { const r = (db.incomes ?? []).filter((e) => e.space_id === a.p_space && String(e.received_at) >= from); return [...sumBy(r, (e) => monthOf(e.received_at), (e) => Number(e.amount_cents))].sort(([x], [y]) => String(x).localeCompare(String(y))).map(([month, total_cents]) => ({ month, total_cents })); }
    case "monthly_mirror": { const r = (db.personal_mirror ?? []).filter((e) => e.enabled && String(e.spent_at) >= from); return [...sumBy(r, (e) => monthOf(e.spent_at), (e) => Number(e.amount_cents))].sort(([x], [y]) => String(x).localeCompare(String(y))).map(([month, total_cents]) => ({ month, total_cents })); }
    case "monthly_breakdown": { const r = (db.expenses ?? []).filter((e) => e.space_id === a.p_space && String(e.spent_at) >= from); return [...sumBy(r, (e) => `${monthOf(e.spent_at)}|${e.category_id ?? ""}`, (e) => Number(e.amount_base_cents))].map(([k, total_cents]) => { const [month, cat] = String(k).split("|"); return { month, category_id: cat || null, total_cents }; }).sort((x, y) => String(x.month).localeCompare(String(y.month))); }
    case "monthly_mirror_by_fund": { const r = (db.personal_mirror ?? []).filter((e) => e.enabled && String(e.spent_at) >= from); return [...sumBy(r, (e) => `${monthOf(e.spent_at)}|${e.fund_id ?? ""}`, (e) => Number(e.amount_cents))].map(([k, total_cents]) => { const [month, fund] = String(k).split("|"); return { month, fund_id: fund || null, total_cents }; }); }
    default: void list; return undefined;
  }
}

export function createDemoClient(db: Db) {
  const user = { id: DEMO_USER_ID, email: "ana@demo.fifti", is_anonymous: false, app_metadata: { demo: true }, user_metadata: { display_name: "Ana" }, aud: "authenticated", created_at: new Date().toISOString() };
  const READ_RPC = new Set(["monthly_spend", "monthly_income", "monthly_mirror", "monthly_breakdown", "monthly_mirror_by_fund"]);
  return {
    from: (table: string) => new Query(db, table),
    rpc: (name: string, args: Record<string, unknown> = {}) => Promise.resolve(READ_RPC.has(name) ? { data: rpc(db, name, args), error: null } : { data: null, error: DEMO_ERROR }),
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: null, error: DEMO_ERROR }),
      updateUser: async () => ({ data: null, error: DEMO_ERROR }),
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: DEMO_ERROR }), upload: async () => ({ data: null, error: DEMO_ERROR }), remove: async () => ({ data: null, error: DEMO_ERROR }) }) },
  };
}
