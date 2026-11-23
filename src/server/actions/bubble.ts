"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BUBBLE_COOKIE, listMySpaces } from "@/server/spaces";

const schema = z.object({ spaceId: z.uuid() }).strict();

/** Cambia la burbuja activa. Se comprueba en servidor que el usuario es miembro (vía RLS). */
export async function selectBubble(fd: FormData) {
  const parsed = schema.safeParse({ spaceId: fd.get("spaceId") });
  if (!parsed.success) return;
  const spaces = await listMySpaces();
  if (!spaces.some((s) => s.id === parsed.data.spaceId)) return;
  (await cookies()).set(BUBBLE_COOKIE, parsed.data.spaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
