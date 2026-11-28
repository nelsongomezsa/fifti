import { z } from "zod";
import { currencySchema } from "./spaces";
import { MAX_AMOUNT_CENTS } from "@/lib/money";

const cents = z.number().int().min(1, "El importe debe ser mayor que 0").max(MAX_AMOUNT_CENTS, "Importe demasiado alto");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Fecha no válida");
export const tagSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_áéíóúñü-]{1,30}$/, "Etiqueta no válida");

export const expenseInputSchema = z
  .object({
    id: z.uuid().optional(),
    clientId: z.uuid(),
    spaceId: z.uuid(),
    description: z.string().trim().min(1, "Pon un concepto").max(120, "Máximo 120 caracteres"),
    categoryId: z.uuid().nullable().optional(),
    spentAt: isoDate,
    amountCents: cents,
    currency: currencySchema,
    paidFrom: z.enum(["member", "pot"]).default("member"),
    splitMode: z.enum(["default", "equal", "custom"]).default("default"),
    participants: z.array(z.uuid()).min(1).max(50),
    custom: z
      .object({ kind: z.enum(["percent", "amount"]), values: z.record(z.uuid(), z.number().int().min(0).max(MAX_AMOUNT_CENTS)) })
      .strict()
      .optional(),
    payers: z
      .array(z.object({ memberId: z.uuid(), amountCents: cents.optional() }).strict())
      .max(50)
      .default([]),
    isPrivate: z.boolean().default(false),
    tags: z.array(tagSchema).max(8).default([]),
    /** Cuenta del movimiento; sin ella se usa la cuenta por defecto del espacio */
    accountId: z.uuid().nullable().optional(),
  })
  .strict();
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const incomeInputSchema = z
  .object({
    id: z.uuid().optional(),
    spaceId: z.uuid(),
    memberId: z.uuid(),
    amountCents: cents,
    source: z.string().trim().min(1).max(60).default("Nómina"),
    receivedAt: isoDate,
    isRecurring: z.boolean().default(false),
    accountId: z.uuid().nullable().optional(),
  })
  .strict();

export const commentSchema = z.object({ expenseId: z.uuid(), spaceId: z.uuid(), body: z.string().trim().min(1).max(500) }).strict();
export const REACTIONS = ["👍", "😂", "😮", "❤️", "🙏", "🔥"] as const;
export const reactionSchema = z.object({ expenseId: z.uuid(), spaceId: z.uuid(), emoji: z.enum(REACTIONS) }).strict();
export const fundSchema = z
  .object({
    spaceId: z.uuid(),
    name: z.string().trim().min(1).max(40),
    kind: z.enum(["fixed", "variable", "savings", "leisure", "investment", "emergency", "contribution", "other"]),
  })
  .strict();
export const categorySchema = z.object({ spaceId: z.uuid(), fundId: z.uuid(), name: z.string().trim().min(1).max(40) }).strict();
export const favoriteSchema = z
  .object({ spaceId: z.uuid(), label: z.string().trim().min(1).max(30), amountCents: cents, categoryId: z.uuid().nullable().optional() })
  .strict();
