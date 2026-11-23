import { saveExpense, type SaveResult } from "@/server/actions/expenses";
import type { ExpenseInput } from "@/lib/validation/expense";

/** Punto único de envío de gastos desde el cliente (la cola offline se engancha aquí). */
export async function submitExpense(input: ExpenseInput): Promise<SaveResult> {
  return saveExpense(input);
}
