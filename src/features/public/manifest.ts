import type { MetadataRoute } from "next";

export function publicValidationManifest(token: string, title: string): MetadataRoute.Manifest {
  const path = `/v/${token}`;
  return {
    id: path, name: `${Array.from(title).slice(0, 80).join("")} · Valweb`, short_name: Array.from(title).slice(0, 12).join("") || "Valweb",
    description: "Consulta documental de Computer Forms. Necesita conexión para validar códigos e imágenes.",
    lang: "es-MX", start_url: path, scope: path, display: "standalone", background_color: "#f5f7fa", theme_color: "#002a45",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
