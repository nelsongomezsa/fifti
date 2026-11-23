import { createHash, randomBytes } from "node:crypto";

/** Token aleatorio de 32 bytes (256 bits). Solo se guarda su hash SHA-256. */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 32 bytes en base64url = 43 caracteres. Descarta cualquier otra cosa antes de tocar la base de datos. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isValidToken = (t: string) => TOKEN_RE.test(t);
