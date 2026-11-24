import { redirect } from "next/navigation";
import { parseQuickExpense } from "@/lib/validation/quick-expense";

/** Abre la hoja "Nuevo gasto" rellenada desde la URL. No guarda nada: quien la abre confirma con un toque. */
export default async function QuickPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = parseQuickExpense(await searchParams);
  const p = new URLSearchParams({ nuevo: "gasto" });
  if (q.amountCents) p.set("importe", (q.amountCents / 100).toFixed(2).replace(".", ","));
  if (q.description) p.set("concepto", q.description);
  if (q.bubble) p.set("burbuja", q.bubble);
  if (q.category) p.set("categoria", q.category);
  redirect(`/inicio?${p.toString()}`);
}
