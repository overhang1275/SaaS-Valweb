import "dotenv/config";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const mode = process.argv[2] || "dev";
assert(["dev", "build", "start"].includes(mode), "Use dev, build or start");
const databaseUrl = process.env.TEST_DATABASE_URL;
assert(databaseUrl && new URL(databaseUrl).pathname === "/valweb_test", "TEST_DATABASE_URL must point to the disposable valweb_test database");
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  NEXTAUTH_URL: "http://localhost:3001",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "2525",
  SMTP_FROM: "Valweb <noreply@example.test>",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  VALWEB_TEST_INSTANCE: "1",
  IMAGE_STORAGE_DIR: resolve("var/test-assets"),
  IMPORT_STORAGE_DIR: resolve("var/test-imports"),
});
const require = createRequire(import.meta.url);
process.argv = [process.execPath, require.resolve("next/dist/bin/next"), mode, ...(mode === "build" ? ["--webpack"] : ["--hostname", "127.0.0.1", "--port", "3001"])];
await import("next/dist/bin/next");
