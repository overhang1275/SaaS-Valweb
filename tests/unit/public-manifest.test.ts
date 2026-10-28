import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { publicValidationManifest } from "../../src/features/public/manifest";
it("gives each validation its own app identity, launch URL and scope", () => {
  const id = randomUUID(), other = randomUUID();
  const manifest = publicValidationManifest(id, "Consulta de documentos");
  expect(manifest).toMatchObject({ id: `/v/${id}`, start_url: `/v/${id}`, scope: `/v/${id}`, display: "standalone", theme_color: "#002a45", lang: "es-MX" });
  expect(manifest.id).not.toBe(publicValidationManifest(other, "Otra").id);
  expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ sizes: "192x192" }), expect.objectContaining({ sizes: "512x512", purpose: "maskable" })]));
});
it("keeps names bounded and does not split Unicode code points", () => {
  expect(publicValidationManifest(randomUUID(), "🙂".repeat(100)).short_name).toBe("🙂".repeat(12));
  expect(publicValidationManifest(randomUUID(), "").short_name).toBe("Valweb");
});
