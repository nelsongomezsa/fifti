/** Para decidir qué se ofrece en pantalla. Quien manda es la base (delete_expense): esto solo evita botones que fallarían. */
export function canDeleteExpense(
  expense: { is_private: boolean; created_by_member: string | null },
  me: { id: string; role: string } | undefined,
): boolean {
  if (!me) return false;
  return (me.role !== "guest" && !expense.is_private) || expense.created_by_member === me.id;
}
