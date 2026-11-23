import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fifti",
    short_name: "Fifti",
    description: "Cuentas claras en casa, en pareja y de fiesta",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    background_color: "#0B0D10",
    theme_color: "#0B0D10",
    lang: "es",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Añadir gasto", url: "/inicio?nuevo=gasto", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Nuevo plan", url: "/inicio?nuevo=plan", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
