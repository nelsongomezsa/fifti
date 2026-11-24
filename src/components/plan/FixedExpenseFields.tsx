"use client";

import { useState } from "react";
import { useTx } from "@/i18n/tx-client";
import { suggestCategory } from "@/lib/nl/parse";
import { matchRule, type CategoryRule } from "@/lib/rules/match";

const FIELD = "min-h-12 w-full rounded-card border border-border bg-surface px-4 text-base text-ink placeholder:text-ink-3";

/** Concepto, importe y categoría del gasto fijo: al escribir el concepto se sugiere la categoría con tus reglas y con el diccionario (Spotify → Suscripciones). */
export function FixedExpenseFields({ categories, rules }: { categories: { id: string; name: string }[]; rules: CategoryRule[] }) {
  const x = useTx();
  const [category, setCategory] = useState("");
  const [touched, setTouched] = useState(false);
  const [hint, setHint] = useState<"regla" | "sugerida" | null>(null);

  const onDescription = (text: string) => {
    if (touched) return;
    const byRule = matchRule(rules, text)?.categoryId ?? null;
    const id = byRule && categories.some((c) => c.id === byRule) ? byRule : suggestCategory(text, categories);
    setCategory(id ?? "");
    setHint(id ? (byRule && id === byRule ? "regla" : "sugerida") : null);
  };

  return (
    <>
      <input name="description" required maxLength={120} placeholder={x("Alquiler")} aria-label={x("Concepto")} className={FIELD} onChange={(e) => onDescription(e.target.value)} />
      <input name="amount" required inputMode="decimal" placeholder="650,00" aria-label={x("Importe")} className={`${FIELD} font-mono`} />
      <div className="flex flex-col gap-1">
        <select name="categoryId" value={category} onChange={(e) => { setCategory(e.target.value); setTouched(true); setHint(null); }} aria-label={x("Categoría")} className={FIELD}>
          <option value="">{x("Sin categoría")}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {hint && <p className="text-xs text-ink-3" aria-live="polite">{hint === "regla" ? x("Categoría según tu regla") : x("Categoría sugerida")}</p>}
      </div>
    </>
  );
}
