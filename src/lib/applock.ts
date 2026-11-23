/**
 * Bloqueo local de la app (PIN y/o biometría del dispositivo). Todo vive en el dispositivo:
 * el PIN se guarda solo como hash PBKDF2 con sal y la credencial WebAuthn nunca sale del móvil.
 * Es un bloqueo de pantalla, no control de acceso al servidor (eso lo hacen la sesión y RLS).
 */
export const PIN_RE = /^\d{4,6}$/;
export const ITERATIONS = 150_000;
export const LOCK_KEY = "fifti:lock";
export const FAIL_KEY = "fifti:lockFails";

export type StoredLock = { pin?: { salt: string; hash: string }; cred?: string };

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS }, key, 256);
  return b64(bits);
}

export async function hashPin(pin: string): Promise<{ salt: string; hash: string }> {
  if (!PIN_RE.test(pin)) throw new RangeError("El PIN debe tener de 4 a 6 dígitos");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: await derive(pin, salt) };
}

export async function verifyPin(pin: string, stored: { salt: string; hash: string }): Promise<boolean> {
  if (!PIN_RE.test(pin)) return false;
  const h = await derive(pin, unb64(stored.salt));
  if (h.length !== stored.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ stored.hash.charCodeAt(i); // comparación en tiempo constante
  return diff === 0;
}

/** Espera tras fallos: 0 hasta 2 fallos; después 2, 4, 8… hasta 5 minutos. */
export function lockoutSeconds(failures: number): number {
  return failures < 3 ? 0 : Math.min(300, 2 ** (failures - 2));
}

export function readLock(): StoredLock | null {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) ?? "null") as StoredLock | null; } catch { return null; }
}
export function writeLock(l: StoredLock | null) {
  try { if (l) localStorage.setItem(LOCK_KEY, JSON.stringify(l)); else { localStorage.removeItem(LOCK_KEY); localStorage.removeItem(FAIL_KEY); } } catch { /* sin almacenamiento */ }
}

/** Registra una credencial biométrica de la plataforma (Face ID, huella, Windows Hello). Devuelve su id en base64. */
export async function createBiometric(): Promise<string | null> {
  if (!window.PublicKeyCredential || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return null;
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: "Fifti" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "fifti-local", displayName: "Fifti" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000, attestation: "none",
    },
  })) as PublicKeyCredential | null;
  return cred ? b64(cred.rawId) : null;
}

export async function verifyBiometric(credId: string): Promise<boolean> {
  try {
    const r = await navigator.credentials.get({
      publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: "public-key", id: unb64(credId) as BufferSource }], userVerification: "required", timeout: 60_000 },
    });
    return !!r;
  } catch { return false; }
}
