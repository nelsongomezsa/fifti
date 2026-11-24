"use server";

import { z } from "zod";
import { getTx } from "@/i18n/tx";
import { mergeResults, parsePhrase, resolveAi, AI_CATEGORIES, type AiAnswer, type NlResult } from "@/lib/nl/parse";
import { createClient } from "@/lib/supabase/server";
import { RULES } from "@/lib/security/rate-limit";
import { allow } from "@/lib/security/user-limit";
import { loadSheetContext } from "./sheet";

const inputSchema = z.object({ phrase: z.string().trim().min(1).max(200), currentSpaceId: z.uuid() }).strict();

const answerSchema = z.object({
  amount: z.number().nullable(),
  description: z.string().max(80).nullable(),
  bubble_alias: z.string().max(20).nullable(),
  category: z.enum(Object.keys(AI_CATEGORIES) as [keyof typeof AI_CATEGORIES, ...(keyof typeof AI_CATEGORIES)[]]).nullable(),
  split: z.enum(["equal", "mine"]).nullable(),
  people: z.array(z.string().max(40)).max(5),
  recurring: z.boolean(),
}).strict();

export type PhraseResult = { ok: true; result: NlResult; usedAi: boolean; note?: string } | { ok: false; error: string };

/**
 * Interpreta la frase. Primero el analizador local (siempre, gratis). Si la persona activó la IA en Más, se pide además a Gemini
 * (solo desde el servidor) y su respuesta, validada con Zod, solo completa lo que el analizador local no pudo deducir.
 */
export async function interpretPhrase(raw: { phrase: string; currentSpaceId: string }): Promise<PhraseResult> {
  const x = await getTx();
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: x("Escribe una frase más corta.") };
  const { phrase, currentSpaceId } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: x("Inicia sesión para continuar.") };
  const [ctx, { data: profile }] = await Promise.all([loadSheetContext(), supabase.from("profiles").select("ai_phrases").eq("id", auth.user.id).maybeSingle()]);
  const spaces = ctx.spaces.map((s) => ({ id: s.id, name: s.name, kind: s.kind, meId: s.meId, members: s.members.map((m) => ({ id: m.id, name: m.name })), categories: s.categories.map((c) => ({ id: c.id, name: c.name })), rules: s.rules }));
  const local = parsePhrase(phrase, spaces, currentSpaceId);

  const key = process.env.GEMINI_API_KEY;
  if (!profile?.ai_phrases || !key) return { ok: true, result: local, usedAi: false };
  if (!(await allow(RULES.aiPhrase, auth.user.id))) return { ok: true, result: local, usedAi: false, note: x("Has llegado al límite diario de frases con IA. Se ha usado el analizador básico.") };

  // Alias genéricos: la IA nunca recibe ids, emails ni los nombres de las burbujas
  const aliases: Record<string, string> = {};
  const list = spaces.map((s, i) => { const a = `burbuja_${i + 1}`; aliases[a] = s.id; return `${a} (${s.kind === "personal" ? "personal" : s.kind === "household" ? "hogar" : "grupo"})`; });
  const prompt = [
    "Extrae los datos de un gasto a partir de una frase en español o inglés. Responde SOLO con JSON.",
    "Campos: amount (euros, número o null), description (corta, o null), bubble_alias (uno de los alias dados o null),",
    `category (uno de: ${Object.keys(AI_CATEGORIES).join(", ")} o null), split ("equal" si se reparte a medias o con otras personas, "mine" si lo paga solo quien habla, o null),`,
    "people (nombres de otras personas que aparecen en la frase), recurring (true si se repite cada mes).",
    `Alias disponibles: ${list.join(", ")}.`,
    `Frase: ${JSON.stringify(phrase)}`,
  ].join("\n");
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const ans = answerSchema.safeParse(JSON.parse(text));
    if (!ans.success) throw new Error("respuesta no válida");
    return { ok: true, result: mergeResults(local, resolveAi(ans.data as AiAnswer, spaces, currentSpaceId, aliases)), usedAi: true };
  } catch (err) {
    console.error("[phrase-ai]", err instanceof Error ? err.message : "error");
    return { ok: true, result: local, usedAi: false };
  }
}
