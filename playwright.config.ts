import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3113";

/**
 * Pruebas de punta a punta. Necesitan la app (build + start) conectada a un Supabase LOCAL y las claves de pruebas
 * en `.env.test.local` (las mismas de los tests de RLS) o en variables de entorno. Cada prueba crea sus propios usuarios ficticios.
 * Móvil (390×844) y escritorio. Trazas y capturas solo si algo falla.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    locale: "es-ES",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "movil", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: process.env.E2E_START_SERVER
    ? { command: "npx next start -p 3113", url: baseURL, reuseExistingServer: true, timeout: 60_000 }
    : undefined,
});
