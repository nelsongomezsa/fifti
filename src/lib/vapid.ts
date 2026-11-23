/** Clave pública VAPID (segura en el navegador). La privada vive solo en el servidor (src/server/push.ts). */
export const vapidPublicKey: string = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
