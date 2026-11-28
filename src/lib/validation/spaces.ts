import { z } from "zod";
import { CURRENCIES } from "@/lib/fx";
import { BP_TOTAL } from "@/lib/money";

export const nameSchema = z.string().trim().min(1, "Pon un nombre").max(40, "Máximo 40 caracteres");
export const currencySchema = z.string().trim().toUpperCase().pipe(z.enum(CURRENCIES, { error: "Moneda no válida" }));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v)), "Fecha no válida");

export const TEMPLATES = ["night", "dinner", "trip", "flat"] as const;

export const createSpaceSchema = z
  .object({
    name: z.string().trim().min(1, "Pon un nombre").max(60),
    kind: z.enum(["household", "group"]),
    currency: currencySchema,
    emoji: z.string().trim().max(8).optional(),
    template: z.enum(TEMPLATES).optional(),
    startsOn: isoDate.optional(),
    endsOn: isoDate.optional(),
  })
  .strict()
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, { message: "La fecha final es anterior a la inicial" });

export const uuidSchema = z.uuid();

export const addMemberSchema = z.object({ spaceId: z.uuid(), name: nameSchema }).strict();

export const linkSchema = z
  .object({
    spaceId: z.uuid(),
    kind: z.enum(["invite", "guest", "public_summary"]),
    days: z.coerce.number().int().min(1).max(90),
    maxUses: z.coerce.number().int().min(1).max(1000),
  })
  .strict();

/** "33,34" o "33.34" -> 3334 puntos básicos; null si no es válido. */
export function parsePercentToBp(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= BP_TOTAL ? bp : null;
}

export const sharesSchema = z
  .array(z.object({ member_id: z.uuid(), bp: z.number().int().min(0).max(BP_TOTAL) }).strict())
  .min(1)
  .max(50)
  .refine((l) => l.reduce((a, b) => a + b.bp, 0) === BP_TOTAL, { message: "Los porcentajes deben sumar 100 %" });

export const guestJoinSchema = z
  .object({ token: z.string().length(43), memberId: z.uuid().optional(), name: nameSchema.optional() })
  .strict()
  .refine((v) => v.memberId || v.name, { message: "Elige tu nombre o escribe uno" });
