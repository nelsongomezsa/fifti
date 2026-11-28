import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import traceExcludes from "./scripts/trace-excludes.json";
import traceImageExcludes from "./scripts/trace-excludes-imagen.json";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDev = process.env.NODE_ENV !== "production";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Realtime (lista de la compra): el mismo origen de Supabase por WebSocket
const supabaseWs = supabaseUrl.replace(/^http/, "ws");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseUrl}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' https://challenges.cloudflare.com ${supabaseUrl} ${supabaseWs}${isDev ? " ws: http://127.0.0.1:54321" : ""}`.trim(),
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Cada pantalla es su propia función en Vercel y su tamaño cuenta en el arranque en frío: los binarios de compilación se
  // dejan fuera de todas, y sharp (libvips, ~28 MB) de todas menos /api/ticket, que recodifica las fotos de los tickets.
  // Ningún otro código puede importar sharp. No usamos next/image.
  // OJO: @swc/helpers NO se puede excluir; Next lo exige en runtime (sin él, todas las rutas dan 500).
  // Las listas viven en scripts/trace-excludes*.json y `npm run check:runtime` comprueba la traza de cada función.
  outputFileTracingExcludes: {
    "*": traceExcludes,
    "!**/api/ticket": traceImageExcludes,
  },
  // libvips se carga en tiempo de ejecución y el rastreo de dependencias no siempre la ve
  outputFileTracingIncludes: {
    "/api/ticket": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
  reactStrictMode: true,
  // Caché de navegación en el cliente: las pantallas ya vistas (o precargadas) salen al instante y se revalidan por detrás (RefreshOnNav)
  experimental: { staleTimes: { dynamic: 180, static: 600 } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
