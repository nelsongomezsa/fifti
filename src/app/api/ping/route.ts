/** Ruta barata para mantener caliente la función: no toca la base de datos ni la sesión. La llama un cron de Supabase cada 5 minutos. */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}
